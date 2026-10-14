"""Run the server: `python -m app`."""

import logging

import uvicorn

from app.config import get_settings

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("google_genai").setLevel(logging.WARNING)  # skip per-request SDK chatter
    settings = get_settings()
    uvicorn.run("app.main:create_app", factory=True, host=settings.host, port=settings.port)
