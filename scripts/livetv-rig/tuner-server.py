"""An ephemeral M3U software tuner that behaves like a LIVE stream.

WHY THIS IS NOT A STATIC FILE SERVER, which is the whole point of the file.

The obvious implementation is `http.server.SimpleHTTPRequestHandler` pointed at a fixture. Over
loopback that hands the entire fixture over in milliseconds, so the server's `SharedHttpStream.Open`
reaches EOF almost immediately, treats the live stream as finished, and deletes the temp `.ts` it
had just begun writing:

    M3UTunerHost: Opening SharedHttpStream Live stream from http://127.0.0.1:18099/channel1.ts
    M3UTunerHost: Live stream opened after 5.5585ms
    M3UTunerHost: Deleting temp file .../<id>.ts
    [ERR] MediaSourceManager: Error probing live tv stream
          System.IO.FileNotFoundException: .../<id>.ts
    [ERR] ExceptionMiddleware: Could not find file ... URL GET /videos/{id}/live.m3u8

The visible symptom is `live.m3u8` answering **404** and no `<video>` element ever existing, which
reads exactly like a server-side Live TV defect and is not one. A real tuner never reaches EOF.

So this paces the body at the fixture's own bitrate and sends no `Content-Length`: an unbounded
body that ends when the socket closes, which is what the tuner host expects.

`EnableStreamLooping` is deliberately left false where the tuner host is registered — a looping
fixture caps every playback proof at the fixture length — so the fixture itself must be longer than
whatever span the proof needs.

    python3 scripts/livetv-rig/tuner-server.py      # serves 127.0.0.1:18099
"""

import os
import socketserver
import sys
import time
from http.server import BaseHTTPRequestHandler

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixture")
FIXTURE = os.path.join(ROOT, "channel1.ts")
PLAYLIST = os.path.join(ROOT, "playlist.m3u")
DURATION_S = float(os.environ.get("TESSERAFIN_TUNER_DURATION", "120"))
CHUNK = 32 * 1024
PORT = int(os.environ.get("TESSERAFIN_TUNER_PORT", "18099"))


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler's contract
        if self.path.endswith(".m3u"):
            with open(PLAYLIST, "rb") as handle:
                body = handle.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/x-mpegurl")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if not self.path.endswith(".ts"):
            self.send_error(404)
            return

        size = os.path.getsize(FIXTURE)
        rate = size / DURATION_S  # bytes of fixture per second of media

        self.send_response(200)
        self.send_header("Content-Type", "video/mp2t")
        self.send_header("Connection", "close")
        self.end_headers()

        started = time.monotonic()
        sent = 0
        with open(FIXTURE, "rb") as handle:
            while True:
                chunk = handle.read(CHUNK)
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                sent += len(chunk)
                ahead = (sent / rate) - (time.monotonic() - started)
                if ahead > 0:
                    time.sleep(min(ahead, 1.0))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    Server(("127.0.0.1", PORT), Handler).serve_forever()
