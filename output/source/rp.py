import sys, base64, subprocess, http.server, threading, functools, os
from playwright.sync_api import sync_playwright
mode=sys.argv[1]; out=sys.argv[2]; ts=[float(x) for x in sys.argv[3:]]
os.makedirs(out,exist_ok=True)
H=functools.partial(http.server.SimpleHTTPRequestHandler,directory='people')
H.log_message=lambda *a:None
srv=http.server.ThreadingHTTPServer(('127.0.0.1',0),H); threading.Thread(target=srv.serve_forever,daemon=True).start()
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome') if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else p.chromium.launch()
    pg=b.new_page(viewport={'width':1080,'height':1920})
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: m.type=='error' and errs.append(m.text))
    pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html'); pg.wait_for_function('window.__ready===true',timeout=30000)
    grab="t=>{window.renderFrame(t);return document.getElementById('cv').toDataURL('image/png').split(',')[1]}"
    if mode=='stills':
        for t in ts:
            open(f'{out}/s{t:05.2f}.png','wb').write(base64.b64decode(pg.evaluate(grab,t)))
    else:
        n=round(20.03*30)
        for i in range(n):
            open(f'{out}/f{i:04d}.png','wb').write(base64.b64decode(pg.evaluate(grab,i/30)))
    print('errors:',errs[:5])
    b.close()
