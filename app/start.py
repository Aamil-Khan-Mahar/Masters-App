"""Start the Masters app: python app/start.py [--port 8000] [--no-browser] [--rebuild]

First run sets everything up (Python venv, npm packages, frontend build).
Later runs only rebuild the frontend when its source changed.
"""

from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

APP = Path(__file__).resolve().parent
VENV = APP / ".venv"
FRONTEND = APP / "frontend"
DIST = FRONTEND / "dist"
PY = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def run(cmd: list[str], cwd: Path = APP) -> None:
    print("  $", " ".join(cmd))
    subprocess.run(cmd, cwd=cwd, check=True, shell=os.name == "nt" and cmd[0] == "npm")


def ensure_backend() -> None:
    if not PY.exists():
        print("Creating Python environment…")
        run([sys.executable, "-m", "venv", str(VENV)])
    stamp = VENV / ".requirements-installed"
    req = APP / "backend" / "requirements.txt"
    if not stamp.exists() or stamp.stat().st_mtime < req.stat().st_mtime:
        print("Installing backend packages…")
        run([str(PY), "-m", "pip", "install", "-q", "-r", str(req)])
        stamp.touch()


def newest(path: Path) -> float:
    return max((p.stat().st_mtime for p in path.rglob("*") if p.is_file()), default=0)


def ensure_frontend(force: bool) -> None:
    if not shutil.which("npm"):
        if DIST.exists():
            return
        sys.exit("Node.js (npm) is required to build the UI the first time: https://nodejs.org")
    if not (FRONTEND / "node_modules").exists():
        print("Installing frontend packages…")
        run(["npm", "install"], cwd=FRONTEND)
    sources = max(newest(FRONTEND / "src"), (FRONTEND / "index.html").stat().st_mtime)
    if force or not (DIST / "index.html").exists() or newest(DIST) < sources:
        print("Building the UI…")
        run(["npm", "run", "build"], cwd=FRONTEND)


def lan_ip() -> str | None:
    """This computer's address on the home network (no traffic is sent)."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
        except OSError:
            return None


def port_free(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--rebuild", action="store_true", help="force a frontend rebuild")
    parser.add_argument("--local-only", action="store_true", help="don't listen on the home network (no phone access)")
    parser.add_argument("--once", action="store_true", help="exit quietly if the app is already running on --port (for the autostart task)")
    args = parser.parse_args()

    if args.once and not port_free(args.port):
        print(f"Already running on port {args.port}.")
        return

    ensure_backend()
    ensure_frontend(args.rebuild)

    port = args.port
    while not port_free(port):
        port += 1
    url = f"http://127.0.0.1:{port}"
    if not (APP / ".env").exists():
        print("\nNote: no app/.env found, so AI features are off. Copy app/.env.example to app/.env and add your key.\n")
    print(f"\nMasters app running at {url}  (Ctrl+C to stop)", flush=True)
    ip = None if args.local_only else lan_ip()
    if ip:
        print(f"On your phone (same Wi-Fi): http://{ip}:{port}", flush=True)
    print(flush=True)

    if not args.no_browser:
        threading.Thread(target=lambda: (time.sleep(1.5), webbrowser.open(url)), daemon=True).start()
    # At boot the network may not be up yet (no ip to print), so listen on it regardless.
    host = "127.0.0.1" if args.local_only else "0.0.0.0"
    try:
        subprocess.run([str(PY), "-m", "uvicorn", "main:app", "--host", host, "--port", str(port), "--log-level", "warning"], cwd=APP / "backend")
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
