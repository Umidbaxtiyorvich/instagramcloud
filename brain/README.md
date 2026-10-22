# brain — o'z miyamiz (tashqi API kalitsiz)

`mavzu -> LLM ssenariy -> ffmpeg montaj -> reel.mp4 + caption.txt`

## Ishga tushirish
1. (Ixtiyoriy, haqiqiy "fikrlash" uchun) Ollama o'rnating: https://ollama.com, so'ng `ollama pull qwen2.5:7b` (GPU shart emas, CPU'da sekinroq ishlaydi).
2. `cd brain && python3 agent.py "Instagramda obunachi oshirish 3 sir"`
3. Natija: `brain/out/reel.mp4`, `caption.txt`, `plan.json`.

Ollama bo'lmasa shablon bilan ishlaydi. `--voice` ovoz uchun `espeak-ng` kerak.
Model almashtirish: `BRAIN_MODEL=llama3.1:8b`.

## Keyingi qadamlar
Rasm (ComfyUI/FLUX) va video (Wan) vositalarini GPU paydo bo'lganda `tools` sifatida qo'shamiz.
