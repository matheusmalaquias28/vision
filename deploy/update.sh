#!/usr/bin/env bash
# Atualiza o VISION no servidor com o que está no GitHub.
# Uso (como o usuário vision): bash /opt/vision/deploy/update.sh
set -euo pipefail

cd /opt/vision
git pull --ff-only
npm ci
npm test
npm run build -w @vision/web
sudo systemctl restart vision
echo "VISION atualizado: $(git log --oneline -1)"
