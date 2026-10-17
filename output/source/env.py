import subprocess, numpy as np, json, sys
raw = subprocess.run(['ffmpeg','-v','error','-i','vo.mp3','-ac','1','-ar','16000','-f','s16le','-'],capture_output=True).stdout
a = np.frombuffer(raw, dtype=np.int16).astype(np.float32)/32768
n = int(len(a)/16000*30)+2
v = np.array([np.sqrt(np.mean(np.append(a[int(i/30*16000):int((i+1)/30*16000)]**2,0))+1e-9) for i in range(n)])
v = v/np.percentile(v,95); v = np.clip(v,0,1)
v = np.where(v<0.12,0,v)
# light smoothing
k = np.array([.25,.5,.25]); v = np.convolve(v,k,mode='same')
open('people/env.js','w').write('window.ENV='+json.dumps([round(float(x),2) for x in v])+';')
print(n, v.max())
