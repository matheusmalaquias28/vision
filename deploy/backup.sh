#!/usr/bin/env bash
# Backup criptografado de media/ e do .env com restic.
# Configuração (repositório, chaves e senha) em /etc/vision-backup.env;
# modelo em deploy/backup.env.example. Agendado pelo cron (ver DEPLOY.md).
set -euo pipefail

set -a
# shellcheck source=/dev/null
source /etc/vision-backup.env
set +a

# Fica de fora o que o VISION gera de novo sozinho: caches de waveform,
# filmstrips e miniaturas. Os renders (MP4) entram — pode excluir com
# --exclude '/opt/vision/media/projects/*/renders' se o espaço apertar.
restic backup /opt/vision/media /opt/vision/.env \
  --exclude '/opt/vision/media/.cache' \
  --exclude '/opt/vision/media/projects/*/filmstrip' \
  --exclude '/opt/vision/media/projects/*/thumbnail.jpg' \
  --tag vision

# 7 diários, 4 semanais, 6 mensais
restic forget --tag vision --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune

# confere uma amostra dos dados a cada execução
restic check --read-data-subset=2%
