@echo off
cd /d "D:\instagramcloud"
echo Starting Instagram Cloud with HTTPS tunnel...
echo.
echo Starting Next.js on port 3001...
start "Next.js" cmd /k "npm run dev"
timeout /t 8 /nobreak
echo.
echo Starting HTTPS tunnel (Cloudflare)...
cloudflared tunnel --url http://localhost:3001
