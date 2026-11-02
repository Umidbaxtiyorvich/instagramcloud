# Sayt + Miya + miya-tg (Telegram qo'ng'iroqlari) — bitta konteynerda, har qanday Linux serverda.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# miya-tg uchun Python muhiti (.tgv) — o'rnatilmasa ham sayt ishlaydi
COPY miya-tg/requirements.txt miya-tg/requirements.txt
RUN python3 -m venv .tgv \
  && (.tgv/bin/pip install -q --no-cache-dir -r miya-tg/requirements.txt || echo "miya-tg: o'rnatilmadi")

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

COPY . .
# build vaqtida baza kerak emas; haqiqiy qiymatlar ishga tushganda .env dan keladi
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" npm run build

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
