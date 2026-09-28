"""QuickByte Notification Service — Flask lab workload."""

from __future__ import annotations

import os
import uuid

from flask import Flask, jsonify, request

APP_VERSION = os.environ.get("APP_VERSION", "v1.0").strip() or "v1.0"

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify({"status": "ok", "version": APP_VERSION}), 200


@app.post("/notify")
def notify():
    payload = request.get_json(silent=True) or {}
    channel = str(payload.get("channel") or "email").strip().lower() or "email"
    order_id = payload.get("order_id") or f"ORD-{uuid.uuid4().hex[:8].upper()}"
    message_id = f"MSG-{uuid.uuid4().hex[:8].upper()}"
    return jsonify({
        "message_id": message_id,
        "order_id": order_id,
        "channel": channel,
        "status": "queued",
        "version": APP_VERSION,
    }), 202


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
