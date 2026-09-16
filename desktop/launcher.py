"""
ATS Resume Builder - Windows desktop launcher.

Serves the bundled web app from a local port and opens it in Microsoft Edge
(or Google Chrome) in "app mode": its own window, no tabs or address bar.
Printing to PDF and file downloads use the browser's native dialogs.
The server stops when the window is closed.

Only the Python standard library is used, so this packages cleanly with
PyInstaller into a single .exe.
"""
import json
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

APP_NAME = "ATS Resume Builder"
DATA_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), APP_NAME)


def log(msg):
    """Append a line to launcher.log in the app's data folder (best effort)."""
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(os.path.join(DATA_DIR, "launcher.log"), "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")
    except OSError:
        pass


def fatal(msg):
    log("FATAL " + msg)
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, msg, APP_NAME, 0x10)
    except Exception:
        pass


def resource_dir():
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    web = os.path.join(base, "web")
    if os.path.isdir(web):
        return web
    # Running from source: project root is one level up from desktop/
    return os.path.abspath(os.path.join(base, ".."))


# The browser keeps saved settings (API key, resume, preferences) per
# origin, and the port is part of the origin. So always try the same
# port first; only if it is taken move to the next one.
PREFERRED_PORTS = list(range(47653, 47663))
STORE_FILE = os.path.join(DATA_DIR, "settings.json")


def pick_port():
    for port in PREFERRED_PORTS:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", port))
                return port
        except OSError:
            continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def read_store():
    try:
        with open(STORE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def write_store(data):
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = STORE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, STORE_FILE)
        return True
    except OSError as exc:
        log(f"could not write settings: {exc!r}")
        return False


class Handler(SimpleHTTPRequestHandler):
    last_beat = time.time()
    seen_beat = False

    def log_message(self, *args):  # keep the console quiet
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/__alive"):
            Handler.last_beat = time.time()
            Handler.seen_beat = True
            self.send_response(204)
            self.end_headers()
            return
        if self.path.startswith("/__store"):
            # On-disk copy of the page's saved settings, so they survive
            # even if the port (and so the browser's storage) changes.
            body = json.dumps(read_store()).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/__store"):
            try:
                length = int(self.headers.get("Content-Length") or 0)
                data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                if not isinstance(data, dict):
                    raise ValueError("expected an object")
                # Merge: a page may hold only part of the data. A null
                # value deletes that key.
                store = read_store()
                for key, value in data.items():
                    if value is None:
                        store.pop(key, None)
                    elif isinstance(value, str):
                        store[key] = value
                ok = write_store(store)
            except (ValueError, OSError):
                ok = False
            self.send_response(204 if ok else 500)
            self.end_headers()
            return
        self.send_response(404)
        self.end_headers()


def find_browser():
    pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    pf = os.environ.get("ProgramFiles", r"C:\Program Files")
    local = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        os.path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(local, "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None


def prepare_profile(profile):
    """Seed the browser profile so Edge/Chrome does not linger in the
    background after the window is closed (which would keep the old
    instance alive and swallow later launches)."""
    default = os.path.join(profile, "Default")
    prefs = os.path.join(default, "Preferences")
    if os.path.exists(prefs):
        return
    try:
        import json
        os.makedirs(default, exist_ok=True)
        with open(prefs, "w", encoding="utf-8") as f:
            json.dump({
                "background_mode": {"enabled": False},
                "browser": {"has_seen_welcome_page": True},
                "profile": {"exit_type": "Normal"},
            }, f)
    except OSError as exc:
        log(f"could not seed preferences: {exc!r}")


def main():
    web_dir = resource_dir()
    port = pick_port()
    url = f"http://127.0.0.1:{port}/index.html?desktop=1"

    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=web_dir))
    threading.Thread(target=server.serve_forever, daemon=True).start()

    profile = os.path.join(DATA_DIR, "browser-profile")
    os.makedirs(profile, exist_ok=True)
    prepare_profile(profile)
    log(f"serving {web_dir} at {url}")

    browser = find_browser()
    proc = None
    if browser:
        args = [
            browser,
            f"--app={url}",
            f"--user-data-dir={profile}",
            "--window-size=1440,920",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-features=TranslateUI",
            "--disable-background-mode",
            "--disable-background-networking",
        ]
        try:
            # In a windowed (no console) exe the standard handles are invalid;
            # give the child explicit ones or Popen can fail with WinError 6.
            proc = subprocess.Popen(
                args, close_fds=True,
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            log(f"opened {browser} on port {port}")
        except OSError as exc:
            log(f"browser launch failed: {exc!r}")
            proc = None
    if proc is None:
        log("falling back to the default browser")
        webbrowser.open(url)

    # Lifetime is driven by the page's heartbeat (GET /__alive every few seconds),
    # not by the browser process: if Edge is already running for this profile it
    # hands the window to that instance and our child process exits at once.
    FIRST_BEAT_GRACE = 90   # seconds to wait for the page to load
    SILENCE_LIMIT = 75      # seconds without a heartbeat before we quit
    #                         (minimised windows throttle timers to ~1/minute)
    start = time.time()
    try:
        while True:
            time.sleep(1)
            now = time.time()
            if not Handler.seen_beat:
                if now - start > FIRST_BEAT_GRACE:
                    log("no page loaded within the grace period; exiting")
                    break
                continue
            if now - Handler.last_beat > SILENCE_LIMIT:
                log("window closed (no heartbeat); exiting")
                break
    finally:
        server.shutdown()
        if proc is not None and proc.poll() is None:
            try:
                proc.terminate()
            except OSError:
                pass


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # surface startup problems instead of dying silently
        fatal(f"Could not start: {exc!r}\n\nSee launcher.log in {DATA_DIR}")
