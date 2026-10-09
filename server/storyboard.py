"""
Storyboard AI scanner
---------------------
Pipeline (mirrors a MATLAB image-processing workflow):

  1. Load + grayscale + denoise
  2. Adaptive threshold (handles uneven lighting on scans)
  3. Morphological close to merge character strokes
  4. Contour detection → find rectangular panels
  5. Filter by area + aspect ratio → keep real storyboard panels
  6. Sort panels top→bottom, then left→right
  7. For each panel: crop image, crop label region (below/above)
  8. OCR label region with Tesseract → cut#, dialogue, seconds, notes
  9. Return structured JSON
"""
import io, re, uuid
from typing import List, Dict
import cv2
import numpy as np
import pytesseract
from PIL import Image

# ---------- tuning constants ----------
MIN_PANEL_AREA_RATIO = 0.02     # panel >= 2% of page
MAX_PANEL_AREA_RATIO = 0.45
MIN_ASPECT = 0.4                 # width/height
MAX_ASPECT = 3.5

def _to_cv(image_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image")
    return img

def _preprocess(gray: np.ndarray) -> np.ndarray:
    # denoise (fast, preserves edges)
    gray = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
    # adaptive threshold — robust to scanner vignetting
    th = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 31, 10
    )
    # close gaps so text/lines inside a panel merge into one blob
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
    closed = cv2.morphologyEx(th, cv2.MORPH_CLOSE, kernel, iterations=2)
    return closed

def _detect_panels(image_bytes: bytes) -> List[Dict]:
    img = _to_cv(image_bytes)
    h, w = img.shape[:2]
    page_area = float(h * w)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    binary = _preprocess(gray)

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    panels = []
    for c in contours:
        x, y, cw, ch = cv2.boundingRect(c)
        if ch == 0: continue
        area_ratio = (cw * ch) / page_area
        if not (MIN_PANEL_AREA_RATIO <= area_ratio <= MAX_PANEL_AREA_RATIO):
            continue
        aspect = cw / float(ch)
        if not (MIN_ASPECT <= aspect <= MAX_ASPECT):
            continue
        # a "panel" must be roughly rectangular
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) < 4 or len(approx) > 8:
            continue
        panels.append({"x": x, "y": y, "w": cw, "h": ch})

    # de-duplicate overlapping detections (keep the largest per cluster)
    panels = _dedupe(panels)
    # sort top→bottom, then left→right (row-bucket so columns read L→R)
    panels.sort(key=lambda p: (p["y"] // max(1, h // 6), p["x"]))
    return panels

def _dedupe(panels: List[Dict]) -> List[Dict]:
    if not panels: return []
    panels = sorted(panels, key=lambda p: p["w"] * p["h"], reverse=True)
    kept = []
    for p in panels:
        if all(_iou(p, k) < 0.25 for k in kept):
            kept.append(p)
    return kept

def _iou(a, b) -> float:
    ax2, ay2 = a["x"]+a["w"], a["y"]+a["h"]
    bx2, by2 = b["x"]+b["w"], b["y"]+b["h"]
    ix1, iy1 = max(a["x"], b["x"]), max(a["y"], b["y"])
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2-ix1), max(0, iy2-iy1)
    inter = iw * ih
    if inter == 0: return 0.0
    union = a["w"]*a["h"] + b["w"]*b["h"] - inter
    return inter / union

# ---------- OCR of label regions ----------
CUT_RE   = re.compile(r"\b(?:SH|SC|CUT|#)?\s*(\d{2,4})\b", re.I)
SEC_RE   = re.compile(r"\b(\d{1,2})\s*(?:sec|s|''|\")\b", re.I)
DIAL_RE  = re.compile(r'(?:"[^"]+"|\([^)]+\))')

def _ocr_label(crop: np.ndarray) -> Dict:
    # upscale for better OCR on small handwriting
    crop = cv2.resize(crop, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # tesseract: treat as single block, permit sparse text
    config = "--oem 3 --psm 6 -l eng"
    try:
        text = pytesseract.image_to_string(th, config=config)
    except Exception:
        text = ""

    cut = None
    m = CUT_RE.search(text)
    if m:
        cut = "SH" + m.group(1).zfill(3)

    secs = None
    ms = SEC_RE.search(text)
    if ms:
        secs = int(ms.group(1))

    dialogue = ""
    md = DIAL_RE.search(text)
    if md:
        dialogue = md.group(0).strip('"').strip("()")

    # remaining lines minus matched tokens = description/notes
    cleaned = CUT_RE.sub("", text)
    cleaned = SEC_RE.sub("", cleaned)
    cleaned = DIAL_RE.sub("", cleaned)
    notes = " ".join(line.strip() for line in cleaned.splitlines() if line.strip())

    return {"cut": cut, "seconds": secs, "dialogue": dialogue, "notes": notes, "raw_text": text}

# ---------- public entrypoint ----------
def analyze_storyboard(image_bytes: bytes, use_agent=None) -> Dict:
    """
    use_agent: optional callable(bytes) -> dict|None
    If the cloud agent returns a valid result, we use it; else local pipeline.
    """
    if use_agent:
        remote = use_agent(image_bytes)
        if remote and remote.get("panels"):
            return _normalize(remote, source="agent")

    img = _to_cv(image_bytes)
    panels_geo = _detect_panels(image_bytes)
    results = []
    for i, p in enumerate(panels_geo):
        x, y, w, h = p["x"], p["y"], p["w"], p["h"]
        panel_crop = img[y:y+h, x:x+w]
        # label region: 25% strip below the panel (configurable per template)
        label_y1 = min(img.shape[0], y + h)
        label_y2 = min(img.shape[0], label_y1 + int(h * 0.35))
        label_crop = img[label_y1:label_y2, x:x+w] if label_y2 > label_y1 else panel_crop

        label = _ocr_label(label_crop)
        panel_b64 = _b64_png(panel_crop)

        results.append({
            "index": i,
            "number": label["cut"] or f"SH{(i+1)*10:03d}",
            "description": label["notes"][:120] or "New shot",
            "notes": label["notes"],
            "dialogue": label["dialogue"],
            "duration": label["seconds"] or 4,
            "thumbnail_b64": panel_b64,
            "confidence": _confidence(label),
            "bbox": p,
        })

    return _normalize({"panels": results}, source="local")

def _confidence(label: Dict) -> float:
    score = 0.0
    if label["cut"]: score += 0.4
    if label["seconds"]: score += 0.3
    if label["notes"]: score += 0.2
    if label["dialogue"]: score += 0.1
    return round(score, 2)

def _b64_png(crop: np.ndarray) -> str:
    import base64
    # shrink panel for thumbnail display
    h, w = crop.shape[:2]
    max_w = 320
    if w > max_w:
        scale = max_w / w
        crop = cv2.resize(crop, (max_w, int(h*scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".png", crop)
    return base64.b64encode(buf.tobytes()).decode("ascii") if ok else ""

def _normalize(payload: Dict, source: str) -> Dict:
    return {
        "import_id": str(uuid.uuid4()),
        "source": source,
        "panel_count": len(payload.get("panels", [])),
        "panels": payload.get("panels", []),
    }