"""Record the 15 s vertical reel: python3 tools/record_film.py [out.mp4]
Serves the project, opens the page in headless Chrome with #film, saves each frame it POSTs, then encodes with ffmpeg."""
import http.server, os, subprocess, sys, threading, tempfile, shutil

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'lead-and-light-reel.mp4'))
FRAMES = tempfile.mkdtemp(prefix='reel-')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
done = threading.Event()

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0)); body = self.rfile.read(n)
        if self.path.startswith('/frame'):
            i = int(self.path.split('i=')[1]); open(os.path.join(FRAMES, f'{i:05d}.png'), 'wb').write(body)
            if i % 30 == 0: print('frame', i, flush=True)
        elif self.path == '/done': done.set()
        self.send_response(200); self.end_headers()

srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8790), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
prof = tempfile.mkdtemp(prefix='reel-chrome-')
chrome = subprocess.Popen([CHROME, '--headless=new', '--use-angle=metal', '--window-size=1080,1920', '--force-device-scale-factor=1',
                           f'--user-data-dir={prof}', '--remote-debugging-port=0', 'http://127.0.0.1:8790/#film'],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    if not done.wait(1800): sys.exit('Timed out waiting for the page to finish')
finally:
    chrome.kill(); srv.shutdown(); shutil.rmtree(prof, ignore_errors=True)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '30', '-i', os.path.join(FRAMES, '%05d.png'),
                '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], check=True)
shutil.rmtree(FRAMES, ignore_errors=True)
print('Wrote', OUT)
