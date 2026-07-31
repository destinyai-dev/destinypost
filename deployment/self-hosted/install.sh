#!/usr/bin/env bash
set -Eeuo pipefail

PRODUCT_NAME="DestinyPost"
DEFAULT_INSTALL_DIR="/opt/destinypost"
DEFAULT_IMAGE="ghcr.io/destinyai-dev/destinypost:latest"
DEFAULT_RELEASE_REPOSITORY="destinyai-dev/destinypost"

INSTALL_DIR="${DESTINYPOST_HOME:-$DEFAULT_INSTALL_DIR}"
IMAGE="${DESTINYPOST_IMAGE:-$DEFAULT_IMAGE}"
DOMAIN="${DESTINYPOST_DOMAIN:-}"
ACME_EMAIL="${ACME_EMAIL:-}"
ASSUME_YES="false"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

say() {
  printf '\n[%s] %s\n' "$PRODUCT_NAME" "$*"
}

fail() {
  printf '\n[%s] ERRO: %s\n' "$PRODUCT_NAME" "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Uso:
  sudo bash install.sh [opcoes]

Opcoes:
  --domain dominio.com
  --email administrador@dominio.com
  --image ghcr.io/empresa/destinypost:versao
  --install-dir /opt/destinypost
  --yes
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --email)
      ACME_EMAIL="${2:-}"
      shift 2
      ;;
    --image)
      IMAGE="${2:-}"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    --yes)
      ASSUME_YES="true"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Opcao desconhecida: $1"
      ;;
  esac
done

[[ "${EUID}" -eq 0 ]] || fail "Execute o instalador com sudo."
[[ -r /etc/os-release ]] || fail "Sistema operacional nao reconhecido."

# shellcheck disable=SC1091
source /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) fail "Use Ubuntu 22.04/24.04 ou Debian 12." ;;
esac

if [[ -z "$DOMAIN" ]]; then
  read -r -p "Dominio apontado para esta VPS: " DOMAIN
fi
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN%%/*}"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] ||
  fail "Dominio invalido: $DOMAIN"

if [[ -z "$ACME_EMAIL" ]]; then
  read -r -p "Email para avisos do certificado HTTPS: " ACME_EMAIL
fi
[[ "$ACME_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] ||
  fail "Email invalido."

TOTAL_MEMORY_MB="$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)"
AVAILABLE_DISK_GB="$(df -Pk "$([[ -d "$INSTALL_DIR" ]] && echo "$INSTALL_DIR" || echo /)" | awk 'NR==2 {print int($4 / 1024 / 1024)}')"

if (( TOTAL_MEMORY_MB < 3800 )); then
  fail "A VPS precisa de pelo menos 4 GB de RAM. Recomendado: 8 GB."
fi
if (( AVAILABLE_DISK_GB < 35 )); then
  fail "Sao necessarios pelo menos 35 GB livres. Recomendado: 80 GB."
fi
if (( TOTAL_MEMORY_MB < 7600 )); then
  say "Aviso: 8 GB de RAM sao recomendados para maior estabilidade."
fi

if [[ -f "$INSTALL_DIR/.env" ]]; then
  fail "Ja existe uma instalacao em $INSTALL_DIR. Use 'destinypost update'."
fi

say "Instalando dependencias do servidor"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl dnsutils gzip iproute2 openssl tar

if ! command -v docker >/dev/null 2>&1; then
  apt-get install -y docker.io
fi

if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y docker-compose-v2 ||
    apt-get install -y docker-compose-plugin ||
    fail "Nao foi possivel instalar Docker Compose."
fi

systemctl enable --now docker

if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '(^|:)(80|443)$'; then
  fail "As portas 80 ou 443 ja estao em uso. Pare o proxy atual e execute novamente."
fi

if ! getent ahostsv4 "$DOMAIN" >/dev/null 2>&1; then
  fail "O dominio ainda nao possui DNS IPv4. Crie o registro A e tente novamente."
fi

mkdir -p "$INSTALL_DIR"
chmod 0750 "$INSTALL_DIR"

copy_local_bundle() {
  [[ -f "$SCRIPT_DIR/docker-compose.production.yml" ]] || return 1
  install -m 0644 "$SCRIPT_DIR/docker-compose.production.yml" "$INSTALL_DIR/docker-compose.yml"
  install -m 0644 "$SCRIPT_DIR/Caddyfile" "$INSTALL_DIR/Caddyfile"
  install -m 0755 "$SCRIPT_DIR/destinypost" "$INSTALL_DIR/destinypost"
  mkdir -p "$INSTALL_DIR/dynamicconfig"
  install -m 0644 \
    "$SCRIPT_DIR/dynamicconfig/development-sql.yaml" \
    "$INSTALL_DIR/dynamicconfig/development-sql.yaml"
}

download_release_bundle() {
  local repository release_base archive checksum
  repository="${DESTINYPOST_GITHUB_REPOSITORY:-$DEFAULT_RELEASE_REPOSITORY}"
  release_base="${DESTINYPOST_RELEASE_BASE_URL:-https://github.com/${repository}/releases/latest/download}"
  archive="$(mktemp)"
  checksum="$(mktemp)"

  say "Baixando pacote de instalacao"
  curl --fail --location --silent --show-error \
    "${release_base}/destinypost-self-hosted.tar.gz" \
    --output "$archive"
  curl --fail --location --silent --show-error \
    "${release_base}/destinypost-self-hosted.tar.gz.sha256" \
    --output "$checksum"

  (
    cd "$(dirname "$archive")"
    printf '%s  %s\n' "$(awk '{print $1}' "$checksum")" "$(basename "$archive")" |
      sha256sum --check --status -
  ) || fail "A assinatura SHA-256 do pacote nao confere."

  tar -xzf "$archive" -C "$INSTALL_DIR"
  rm -f "$archive" "$checksum"
}

copy_local_bundle || download_release_bundle

POSTGRES_PASSWORD="$(openssl rand -hex 24)"
REDIS_PASSWORD="$(openssl rand -hex 24)"
TEMPORAL_POSTGRES_PASSWORD="$(openssl rand -hex 24)"
JWT_SECRET="$(openssl rand -base64 64 | tr -d '\n')"
ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"

umask 077
cat >"$INSTALL_DIR/.env" <<EOF
DESTINYPOST_DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
DESTINYPOST_IMAGE=$IMAGE

POSTGRES_USER=destinypost
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=destinypost
REDIS_PASSWORD=$REDIS_PASSWORD
TEMPORAL_POSTGRES_USER=temporal
TEMPORAL_POSTGRES_PASSWORD=$TEMPORAL_POSTGRES_PASSWORD

JWT_SECRET=$JWT_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY

NEXT_PUBLIC_POLOTNO=
STATUS_INFRA_HEALTH_ENABLED=true
SOURCE_CODE_URL=https://github.com/${DESTINYPOST_GITHUB_REPOSITORY:-$DEFAULT_RELEASE_REPOSITORY}
EOF
chmod 0600 "$INSTALL_DIR/.env"

install -m 0755 "$INSTALL_DIR/destinypost" /usr/local/bin/destinypost

cat >/etc/systemd/system/destinypost-backup.service <<EOF
[Unit]
Description=Backup diario do DestinyPost
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
Environment=DESTINYPOST_HOME=$INSTALL_DIR
ExecStart=/usr/local/bin/destinypost backup --quiet
EOF

cat >/etc/systemd/system/destinypost-backup.timer <<'EOF'
[Unit]
Description=Agenda o backup diario do DestinyPost

[Timer]
OnCalendar=*-*-* 03:15:00
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now destinypost-backup.timer

say "Validando a configuracao"
(
  cd "$INSTALL_DIR"
  docker compose config --quiet
)

say "Baixando imagens e iniciando os servicos"
(
  cd "$INSTALL_DIR"
  docker compose pull
  docker compose up -d
)

say "Aguardando o DestinyPost ficar pronto"
READY="false"
for _ in $(seq 1 90); do
  if curl --fail --silent --show-error "https://${DOMAIN}/" >/dev/null 2>&1; then
    READY="true"
    break
  fi
  sleep 5
done

if [[ "$READY" != "true" ]]; then
  say "A aplicacao ainda esta inicializando. Execute 'destinypost logs' para acompanhar."
else
  say "Instalacao concluida."
fi

cat <<EOF

Endereco: https://${DOMAIN}

Abra o endereco e crie a primeira conta. Ela sera a administradora.
Depois do primeiro cadastro, o registro publico sera bloqueado.

Comandos:
  destinypost status
  destinypost logs
  destinypost backup
  destinypost update
  destinypost doctor
EOF
