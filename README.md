# Production Workspace — MVP + Storyboard AI

## Local run
```bash
# 1. system dep
sudo apt-get install -y tesseract-ocr   # macOS: brew install tesseract

# 2. python
python -m venv .venv && source .venv/bin/activate
pip install -r server/requirements.txt

# 3. config
cp .env.example .env

# 4. run
python server/app.py
# open http://localhost:5000
```

## Deploy (Railway / Render / Fly.io)
- Buildpack: add `aptfile` with `tesseract-ocr`
- Start command: `python server/app.py`
- Set env: `PORT`, `USE_AGENT=1`, `AGENT_URL=…`

## API reference
| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/api/workspace`                 | Load state |
| POST | `/api/workspace`                 | Save state |
| POST | `/api/import/scan`               | Upload + AI scan |
| GET  | `/api/import/list`               | Import history |
| POST | `/api/import/<id>/review`        | Save corrections |
| POST | `/api/import/<id>/commit`        | Merge to shots |

## How the scanner works
1. Adaptive threshold → robust to scanner vignette
2. Morph close → merges strokes inside panels
3. Contour + rectangle filter → detects panels
4. OCR per panel (cut#/sec/dialogue) → structured JSON
5. Optional: forwarded to your Cloudflare agent for heavy vision