@echo off
rem Miya uchun katta ochiq modelni o'rnatadi: Ollama + Qwen 2.5 (7B). Bir marta ishga tushiriladi.
where ollama >nul 2>nul
if errorlevel 1 (
  echo Ollama o'rnatilmoqda...
  winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo Avtomatik o'rnatib bo'lmadi. https://ollama.com/download dan yuklab o'rnating va bu faylni qayta ishga tushiring.
    pause
    exit /b 1
  )
  set "PATH=%LOCALAPPDATA%\Programs\Ollama;%PATH%"
)
echo Qwen 2.5 modeli yuklanmoqda (~4.7 GB)...
ollama pull qwen2.5:7b
echo Tayyor! Endi miya.bat ni ishga tushiring.
pause
