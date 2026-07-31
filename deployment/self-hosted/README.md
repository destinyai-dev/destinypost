# DestinyPost Self-Hosted

Este pacote instala uma instancia isolada do DestinyPost em uma VPS do
cliente. Banco, midias, credenciais e contas sociais permanecem na VPS.

## Requisitos

- Ubuntu 22.04/24.04 ou Debian 12;
- 4 GB de RAM no minimo, 8 GB recomendado;
- 35 GB livres no minimo, 80 GB recomendado;
- IPv4 publico e dominio apontado para a VPS;
- portas TCP 22, 80 e 443 liberadas.

## Instalacao

Baixe o instalador e valide o checksum publicado na mesma release:

```bash
curl -fsSLO https://github.com/destinyai-dev/destinypost/releases/latest/download/install.sh
curl -fsSLO https://github.com/destinyai-dev/destinypost/releases/latest/download/install.sh.sha256
sha256sum -c install.sh.sha256
sudo bash install.sh
```

O instalador gera senhas unicas, sobe os containers, configura HTTPS e
habilita backup diario. Nenhuma chave de API de desenvolvimento e incluida.

## Primeiro acesso

Abra o dominio informado e crie a primeira conta. Com
`DISABLE_REGISTRATION=true`, apenas o primeiro cadastro publico e aceito.
Novos membros entram por convite.

Em **Configuracoes > Configuracao inicial**:

1. cadastre os aplicativos Meta e demais redes;
2. configure o modelo de texto e os modelos opcionais de IA;
3. configure Canva, Pexels e, opcionalmente, a licenca do Polotno;
4. conecte as contas sociais.

Os segredos informados pela interface sao criptografados com AES-256-GCM.
Preserve `ENCRYPTION_KEY` em backups; sua troca invalida os segredos salvos.

## Operacao

```bash
destinypost status
destinypost logs
destinypost doctor
destinypost backup
destinypost restore /opt/destinypost/backups/AAAAMMDDTHHMMSSZ
destinypost update
```

O backup diario e executado pelo timer `destinypost-backup.timer` e mantem
14 dias localmente. Para producao comercial, copie os backups para outro
provedor ou armazenamento S3/R2.

## Publicacao

Uma tag `v*` executa o workflow `release-self-hosted.yml`, que:

- compila e publica a imagem no GitHub Container Registry;
- monta o pacote self-hosted;
- publica instalador, checksums e arquivos na GitHub Release.

O workflow usa `destinyai-dev/destinypost` como repositorio oficial e ajusta
automaticamente a imagem para a tag publicada.

## Licenca

Este fork e distribuido sob GNU AGPL-3.0. Preserve os avisos, a licenca e a
oferta de codigo-fonte correspondente em todas as distribuicoes.
