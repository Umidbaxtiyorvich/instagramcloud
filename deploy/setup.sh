#!/usr/bin/env bash
# Yangi Ubuntu serverni (Oracle Cloud Always Free) tayyorlaydi: Docker, 80/443 portlar, .env.
# Ishlatish (serverda, loyiha papkasida):  bash deploy/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi
sudo systemctl enable --now docker

# Oracle Ubuntu obrazlarida iptables 80/443 ni yopib qo'ygan
if ! sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null; then
  sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
  sudo iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
  sudo apt-get install -y iptables-persistent >/dev/null || true
  sudo netfilter-persistent save || true
fi

if [ ! -f .env ]; then
  cp deploy/env.server.example .env
  IP=$(curl -fsS https://api.ipify.org)
  sed -i "s/^DOMAIN=.*/DOMAIN=${IP//./-}.sslip.io/" .env
  sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=$(openssl rand -hex 24)/" .env
  echo
  echo ".env yaratildi. Endi uni to'ldiring:  nano .env"
  echo "Render'dagi AUTH_SECRET va TOKEN_ENCRYPTION_KEY aynan o'sha bo'lishi SHART."
  echo "Keyin:  bash deploy/kochirish.sh   (eski bazani ko'chirish)"
  exit 0
fi

sg docker -c "docker compose up -d --build"
sg docker -c "docker compose ps"
echo "Sayt: https://$(grep ^DOMAIN= .env | cut -d= -f2)"
