#!/usr/bin/env bash
set -Eeuo pipefail

mkdir -p /uploads /config

nginx
exec pnpm run pm2
