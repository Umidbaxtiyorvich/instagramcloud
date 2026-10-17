import subprocess, numpy as np, json, sys
V=sys.argv[1]
spd={'A':1.0,'B':1.0,'C':1.12}[V]
# hook (optionally sped up) + 0.1s gap + body
subprocess.run(['ffmpeg','-v','error','-y','-i',f'hook{V}.mp3','-i','body.mp3','-filter_complex',
 f"[0:a]atempo={spd},aresample=44100,apad=pad_dur=0.1[h];[1:a]aresample=44100[b];[h][b]concat=n=2:v=0:a=1[o]",'-map','[o]',f'vo_{V}.wav'],check=True)
raw=subprocess.run(['ffmpeg','-v','error','-i',f'hook{V}.mp3','-af',f'atempo={spd}','-f','wav','-'],capture_output=True).stdout
# hook duration
import io,wave
dur=float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f'hook{V}.mp3'],capture_output=True,text=True).stdout)/spd
tot=float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f'vo_{V}.wav'],capture_output=True,text=True).stdout)
H=dur+0.1
r=subprocess.run(['ffmpeg','-v','error','-i',f'vo_{V}.wav','-ac','1','-ar','16000','-f','s16le','-'],capture_output=True).stdout
a=np.frombuffer(r,dtype=np.int16).astype(np.float32)/32768
n=int(len(a)/16000*30)+3
v=np.array([np.sqrt(np.mean(np.append(a[int(i/30*16000):int((i+1)/30*16000)]**2,0))+1e-9) for i in range(n)])
v=np.clip(v/np.percentile(v,95),0,1); v=np.where(v<0.12,0,v); v=np.convolve(v,[.25,.5,.25],mode='same')
open(f'people/env.js','w').write('window.ENV='+json.dumps([round(float(x),2) for x in v])+';')
open('people/cfg.js','w').write('window.CFG='+json.dumps({'hook':V,'H':round(H,3),'total':round(tot,3)})+';')
print(V,'H',round(H,2),'total',round(tot,2))
