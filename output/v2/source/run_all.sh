set -e
cd "$(dirname "$0")"
for V in A B C; do
  uv run --with numpy python build_audio.py $V 2>&1 | tail -1
  rm -rf fr_$V
  uv run --with playwright==1.56.0 python rp.py frames fr_$V 2>&1 | tail -1
  ffmpeg -hide_banner -loglevel error -y -framerate 30 -i fr_$V/f%04d.png -i vo_$V.wav -c:v libx264 -crf 17 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest reel_$V.mp4
  ffprobe -v error -show_entries format=duration -of csv=p=0 reel_$V.mp4
done
