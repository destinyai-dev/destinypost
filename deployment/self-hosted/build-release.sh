#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="$ROOT_DIR/deployment/self-hosted"
OUTPUT_DIR="${1:-$ROOT_DIR/dist/self-hosted}"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/bundle"

install -m 0644 "$SOURCE_DIR/Caddyfile" "$OUTPUT_DIR/bundle/Caddyfile"
install -m 0644 \
  "$SOURCE_DIR/docker-compose.production.yml" \
  "$OUTPUT_DIR/bundle/docker-compose.yml"
install -m 0755 "$SOURCE_DIR/destinypost" "$OUTPUT_DIR/bundle/destinypost"
mkdir -p "$OUTPUT_DIR/bundle/dynamicconfig"
install -m 0644 \
  "$SOURCE_DIR/dynamicconfig/development-sql.yaml" \
  "$OUTPUT_DIR/bundle/dynamicconfig/development-sql.yaml"

tar -C "$OUTPUT_DIR/bundle" -czf \
  "$OUTPUT_DIR/destinypost-self-hosted.tar.gz" .

install -m 0755 "$SOURCE_DIR/install.sh" "$OUTPUT_DIR/install.sh"

(
  cd "$OUTPUT_DIR"
  sha256sum destinypost-self-hosted.tar.gz \
    >destinypost-self-hosted.tar.gz.sha256
  sha256sum install.sh >install.sh.sha256
)

rm -rf "$OUTPUT_DIR/bundle"
printf 'Pacote criado em %s\n' "$OUTPUT_DIR"
