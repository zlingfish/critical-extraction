#!/usr/bin/env python3

import argparse
import email.utils
import gzip
import io
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    # The standalone page is a few megabytes because the game is bundled into
    # one file. Compress text responses so first load stays responsive on a
    # slower public connection.
    def send_head(self):
        path = self.translate_path(self.path)
        accepts_gzip = "gzip" in self.headers.get("Accept-Encoding", "").lower()
        compressible = path.lower().endswith((".html", ".js", ".css", ".json", ".svg"))
        if accepts_gzip and compressible and os.path.isfile(path):
            try:
                with open(path, "rb") as source:
                    payload = gzip.compress(source.read(), compresslevel=6, mtime=0)
                self.send_response(200)
                self.send_header("Content-type", self.guess_type(path))
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Vary", "Accept-Encoding")
                self.send_header("Content-Length", str(len(payload)))
                self.send_header(
                    "Last-Modified",
                    email.utils.formatdate(os.stat(path).st_mtime, usegmt=True),
                )
                self.end_headers()
                return io.BytesIO(payload)
            except OSError:
                pass
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--directory", required=True)
    args = parser.parse_args()

    handler = partial(NoCacheHandler, directory=args.directory)
    server = ThreadingHTTPServer((args.bind, args.port), handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
