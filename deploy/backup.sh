#!/usr/bin/env bash
# Backup criptografado de media/ e do .env com restic.
# Configuração (repositório, chaves e senha) em /etc/vision-backup.env;
# modelo em deploy/backup.env.example. Agendado pelo cron (ver DEPLOY.md).
set -euo pipefail

set -a
# shellcheck source=/dev/null
source /etc/vision-backup.env
set +a

# Fica de fora o que o VISION gera de novo sozinho (caches de waveform,
# filmstrips, miniaturas) e os vídeos brutos: eles continuam no Drive de
# Materiais do cliente e a limpeza automática os apaga mesmo. Entram as
# receitas (o trabalho de edição), transcrições, áudios tratados e renders.
restic backup /opt/vision/media /opt/vision/.env \
  --exclude '/opt/vision/media/.cache' \
  --exclude '/opt/vision/media/projects/*/filmstrip' \
  --exclude '/opt/vision/media/projects/*/thumbnail.jpg' \
  --exclude '/opt/vision/media/projects/*/source-*' \
  --exclude '/opt/vision/media/projects/*/original-*' \
  --tag vision

# 7 diários, 4 semanais, 6 mensais
restic forget --tag vision --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune

# confere uma amostra dos dados a cada execução
restic check --read-data-subset=2%
