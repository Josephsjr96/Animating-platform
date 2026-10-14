"""
Optional: routes heavy OCR / vision tasks to your Cloudflare worker.
If AGENT_URL is not set or the call fails, the local OpenCV+Tesseract
pipeline in storyboard.py is used as a fallback.
"""
import os, base64, requests
from dotenv import load_dotenv

load_dotenv()
AGENT_URL = os.getenv("AGENT_URL", "https://flat-waterfall-436c.josephsanjari1996.workers.dev")
AGENT_TOKEN = os.getenv("AGENT_TOKEN", "")
TIMEOUT = 45

def agent_analyze(image_bytes: bytes, template: str = "default") -> dict | None:
    """Send image to the live agent; return structured JSON or None on failure."""
    if not AGENT_URL:
        return None
    try:
        b64 = base64.b64encode(image_bytes).decode("ascii")
        headers = {"Content-Type": "application/json"}
        if AGENT_TOKEN:
            headers["Authorization"] = f"Bearer {AGENT_TOKEN}"
        r = requests.post(
            f"{AGENT_URL.rstrip('/')}/analyze",
            json={"image_b64": b64, "template": template,
                  "task": "Japanese storyboard visual understanding",
                  "instructions": "Use image vision, not Latin OCR. Detect Japanese animation e-konte layout: left narrow cut-number margin, central vertically stacked framed drawings, right-side handwritten production notes, and printed top headers. Detect every illustrated panel, but do NOT assume each panel is a separate cut. Associate left-margin cut identifiers and right-side notes by vertical alignment; a cut may span multiple panels. Return panels in top-to-bottom order with pixel bbox {x,y,w,h} for artwork ONLY, number (repeat only when clearly shared), description, notes in original Japanese, dialogue, duration in seconds ONLY when explicitly legible, confidence. Do not invent translations, cut numbers or seconds; use null or empty strings. Return JSON only."},
            headers=headers, timeout=TIMEOUT,
        )
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"[agent_proxy] fallback to local pipeline: {e}")
        return None