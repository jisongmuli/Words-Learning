"""Start a hidden local server and reuse it when it is already running."""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
URL = 'http://127.0.0.1:8765'


def ready():
    try:
        with urllib.request.urlopen(URL + '/api/bootstrap', timeout=1) as response:
            result = json.load(response)
            if result.get('app') != 'word-study':
                raise RuntimeError('Port 8765 is occupied by another application.')
            return True
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        return False


def launch(open_browser=True):
    if ready():
        if open_browser:
            webbrowser.open(URL)
        return
    try:
        import reportlab
    except ImportError:
        raise RuntimeError('Install PDF support first: python -m pip install -r requirements.txt')
    log_dir = ROOT / 'data' / 'user'
    log_dir.mkdir(parents=True, exist_ok=True)
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    with (log_dir / 'server.log').open('ab') as output, (log_dir / 'server-error.log').open('ab') as errors:
        process = subprocess.Popen([sys.executable, '-u', str(ROOT / 'server.py')], cwd=ROOT,
                                   stdout=output, stderr=errors, creationflags=flags)
    (log_dir / 'server.pid').write_text(str(process.pid), encoding='ascii')
    for _ in range(40):
        if process.poll() is not None:
            raise RuntimeError('The local server could not start. See data/user/server-error.log.')
        if ready():
            if open_browser:
                webbrowser.open(URL)
            print(URL)
            return
        time.sleep(0.25)
    raise RuntimeError('The server did not respond. See data/user/server-error.log.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    try:
        launch(not args.no_browser)
    except Exception as error:
        print(error, file=sys.stderr)
        sys.exit(1)
