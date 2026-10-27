#!/usr/bin/env bash
# Render'dagi bazani yangi serverga ko'chiradi (foydalanuvchilar, Instagram ulanishlari, qoidalar,
# jurnal, Miya xotirasi, Telegram sessiyasi — hammasi bazada).
# Ishlatish:  bash deploy/kochirish.sh "postgresql://...render.com/instagramcloud"
#   URL: Render → instagramcloud-db → Connect → External Database URL
set -euo pipefail
cd "$(dirname "$0")/.."
ESKI="${1:?Render bazasining External Database URL ini bering}"
DOMAIN=$(grep ^DOMAIN= .env | cut -d= -f2)

docker compose up -d db
until docker compose exec -T db pg_isready -U instagramcloud >/dev/null 2>&1; do sleep 2; done

mkdir -p backups
docker compose exec -T db pg_dump --no-owner --no-acl "$ESKI" > backups/render-$(date +%F).sql
echo "Render bazasi saqlandi: backups/render-$(date +%F).sql ($(wc -c < backups/render-$(date +%F).sql) bayt)"

docker compose exec -T db psql -q -U instagramcloud -d instagramcloud \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -U instagramcloud -d instagramcloud \
  < backups/render-$(date +%F).sql
echo "Baza ko'chirildi."

docker compose up -d --build
docker compose ps
echo "Sayt: https://$DOMAIN"
