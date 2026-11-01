"""A tiny local stand-in for the AI servers, so tests never touch the internet or spend money."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class FakeAi:
    def __init__(self):
        self.calls: list[dict] = []
        self.status = 200
        self.text = json.dumps(
            {
                "suggestions": [
                    {"text": "Streetlights hum a lullaby for the lost", "reason": "image"},
                    {"text": "Midnight keeps the secrets that I toss", "reason": "rhymes"},
                ]
            }
        )
        self.stop = "end_turn"
        self.in_tokens, self.out_tokens = 400, 100
        self.error_message = "boom"
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):  # silence
                pass

            def do_POST(self):
                n = int(self.headers.get("content-length", 0))
                body = json.loads(self.rfile.read(n) or b"{}")
                outer.calls.append({"path": self.path, "body": body, "headers": dict(self.headers)})
                if outer.status != 200:
                    self._send(
                        outer.status,
                        {
                            "type": "error",
                            "error": {"type": "api_error", "message": outer.error_message},
                        },
                    )
                    return
                if self.path.endswith("/chat/completions"):
                    self._send(
                        200,
                        {
                            "choices": [
                                {"message": {"content": outer.text}, "finish_reason": "stop"}
                            ],
                            "usage": {
                                "prompt_tokens": outer.in_tokens,
                                "completion_tokens": outer.out_tokens,
                            },
                        },
                    )
                else:
                    self._send(
                        200,
                        {
                            "id": "msg_1",
                            "type": "message",
                            "role": "assistant",
                            "model": body.get("model"),
                            "content": [{"type": "text", "text": outer.text}],
                            "stop_reason": outer.stop,
                            "stop_sequence": None,
                            "usage": {
                                "input_tokens": outer.in_tokens,
                                "output_tokens": outer.out_tokens,
                            },
                        },
                    )

            def _send(self, code, obj):
                data = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
