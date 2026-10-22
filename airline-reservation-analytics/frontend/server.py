"""Lightweight Frontend Server (port 3000) serving Customer (/) and Manager (/manager) pages.

Dynamically injects the backend base URL from config.yaml (or falls back to same-host :8000)
so that Playwright tests in R8 and R9 work seamlessly regardless of EC2 IP changes.
Static files (CSS, JS, images) are served from frontend/assets/ under /assets/.
"""
import mimetypes
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

import yaml

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(FRONTEND_DIR, "assets")
CONFIG_PATH = os.environ.get("CONFIG_PATH", os.path.join(ROOT_DIR, "config.yaml"))

mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("text/javascript", ".js")


def get_configured_backend_url() -> str:
    env_url = os.environ.get("BACKEND_URL", "").strip()
    if env_url:
        return env_url.rstrip("/")
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = yaml.safe_load(f) or {}
            url = (cfg.get("backend") or {}).get("base_url", "").strip()
            if url and "YOUR-EC2-IP" not in url:
                return url.rstrip("/")
        except Exception:
            pass
    return ""


class FrontendHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0].split("#")[0].rstrip("/")
        if path in ("", "/index.html"):
            self._serve_html("index.html")
        elif path in ("/manager", "/manager.html"):
            self._serve_html("manager.html")
        elif path.startswith("/assets/"):
            self._serve_asset(path[len("/assets/"):])
        elif path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        else:
            self.send_error(404, "Not Found")

    def _serve_html(self, filename: str):
        filepath = os.path.join(FRONTEND_DIR, filename)
        if not os.path.exists(filepath):
            self.send_error(404, "File Not Found")
            return
        with open(filepath, "r", encoding="utf-8") as f:
            html = f.read()

        backend_url = get_configured_backend_url()
        html = html.replace("__CONFIG_BACKEND_URL__", backend_url)
        body = html.encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _serve_asset(self, rel_path: str):
        # Resolve inside ASSETS_DIR only (blocks ../ path traversal)
        full = os.path.realpath(os.path.join(ASSETS_DIR, unquote(rel_path)))
        if not full.startswith(os.path.realpath(ASSETS_DIR) + os.sep) or not os.path.isfile(full):
            self.send_error(404, "Not Found")
            return
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("FRONTEND_PORT", "3000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), FrontendHandler)
    print(f"Frontend server listening on http://0.0.0.0:{port}")
    server.serve_forever()
