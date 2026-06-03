from io import BytesIO
from pathlib import Path
import cgi
import sys
from http.server import BaseHTTPRequestHandler

from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crop_compose import auto_crop_document, create_final_canvas  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    "REQUEST_METHOD": "POST",
                    "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                },
            )

            output_format = "png" if form.getfirst("format") == "png" else "jpeg"
            front = self._load_upload(form, "front")
            back = self._load_upload(form, "back")
            zalo = self._load_upload(form, "zalo")

            front = auto_crop_document(front, prefer_card=True)
            back = auto_crop_document(back, prefer_card=True)
            zalo = auto_crop_document(zalo, prefer_card=False)
            final_image = create_final_canvas(front, back, zalo)

            buffer = BytesIO()
            if output_format == "png":
                final_image.save(buffer, format="PNG")
                content_type = "image/png"
            else:
                final_image.save(buffer, format="JPEG", quality=95, optimize=True)
                content_type = "image/jpeg"

            payload = buffer.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as exc:
            payload = str(exc).encode("utf-8", errors="replace")
            self.send_response(500)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def _load_upload(self, form: cgi.FieldStorage, key: str) -> Image.Image:
        item = form[key] if key in form else None
        if item is None or not getattr(item, "file", None):
            raise ValueError(f"Missing file: {key}")
        return ImageOps.exif_transpose(Image.open(item.file)).convert("RGB")
