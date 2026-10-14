import io, os, uuid, json
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
from dotenv import load_dotenv

from db import init_db, load_workspace, save_workspace, save_import, get_import, list_imports
from storyboard import analyze_storyboard
from agent_proxy import agent_analyze

load_dotenv()
UPLOAD_DIR = Path("data/uploads"); UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder="../static", static_url_path="/static")
CORS(app)
init_db()

# ---------- workspace (your original seed-data flow) ----------
@app.get("/api/workspace")
def api_get_workspace():
    data = load_workspace()
    return jsonify(data) if data else jsonify({"empty": True})

@app.post("/api/workspace")
def api_save_workspace():
    payload = request.get_json(force=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "invalid payload"}), 400
    save_workspace(payload)
    return jsonify({"ok": True})

# ---------- storyboard import ----------
@app.post("/api/import/scan")
def api_scan():
    """
    Multipart upload: field 'file'.
    Returns structured JSON with panels + thumbnails (base64).
    """
    if "file" not in request.files:
        return jsonify({"error": "no file provided"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "empty filename"}), 400
    image_bytes = f.read()
    if not image_bytes:
        return jsonify({"error": "empty file"}), 400

    # persist original scan for audit
    ext = Path(f.filename).suffix or ".png"
    safe_name = f"{uuid.uuid4().hex}{ext}"
    (UPLOAD_DIR / safe_name).write_bytes(image_bytes)

    use_agent = os.getenv("USE_AGENT", "1") == "1"
    agent_fn = (lambda b: agent_analyze(b)) if use_agent else None

    try:
        result = analyze_storyboard(image_bytes, use_agent=agent_fn)
    except Exception as e:
        return jsonify({"error": f"scan failed: {e}"}), 500

    result["filename"] = f.filename
    save_import(result["import_id"], f.filename, result, status="pending")
    return jsonify(result)

@app.get("/api/import/list")
def api_list():
    return jsonify(list_imports())

@app.get("/api/import/<import_id>")
def api_get_import(import_id):
    rec = get_import(import_id)
    if not rec: return jsonify({"error": "not found"}), 404
    return jsonify(rec)

@app.post("/api/import/<import_id>/review")
def api_review(import_id):
    """
    Body: { panels: [ {number, description, notes, dialogue, duration, include} ] }
    Saves the corrected version, still pending commit.
    """
    rec = get_import(import_id)
    if not rec: return jsonify({"error": "not found"}), 404
    body = request.get_json(force=True)
    save_import(import_id, rec["filename"], rec["raw"], reviewed=body, status="reviewed")
    return jsonify({"ok": True})

@app.post("/api/import/<import_id>/commit")
def api_commit(import_id):
    """
    Merge reviewed panels into workspace.shots.
    Body (optional): { default_element: "Main Character", default_stage_ids: [...] }
    """
    rec = get_import(import_id)
    if not rec: return jsonify({"error": "not found"}), 404
    panels = (rec["reviewed"] or {}).get("panels") or rec["raw"]["panels"]

    ws = load_workspace() or {"shots": [], "stages": [], "people": [], "cells": {}, "project": {}}
    ws.setdefault("shots", [])

    body = request.get_json(silent=True) or {}
    default_elem_name = body.get("default_element", "Main Character")
    default_stage_ids = body.get("default_stage_ids", [])

    added = []
    for p in panels:
        if not p.get("include", True): continue
        shot_id = "sh_" + uuid.uuid4().hex[:8]
        shot = {
            "id": shot_id,
            "number": p.get("number") or f"SH{(len(ws['shots'])+1)*10:03d}",
            "description": p.get("description", ""),
            "notes": p.get("notes", ""),
            "dialogue": p.get("dialogue", ""),
            "duration": int(p.get("duration") or 4),
            "order": len(ws["shots"]),
            "thumbnail": p.get("thumbnail_b64", ""),
            "elements": [{"id": "el_" + uuid.uuid4().hex[:8], "name": default_elem_name}],
        }
        ws["shots"].append(shot)
        # pre-create cells for declared stages
        for st_id in default_stage_ids:
            key = f"{shot_id}|{shot['elements'][0]['id']}|{st_id}"
            ws.setdefault("cells", {})[key] = {
                "status": "not_started", "assignee": None,
                "due": "", "completedAt": None
            }
        added.append(shot_id)

    save_workspace(ws)
    save_import(import_id, rec["filename"], rec["raw"],
                reviewed=rec["reviewed"], status="committed")
    return jsonify({"ok": True, "added": added, "total_shots": len(ws["shots"])})

# ---------- static ----------
@app.get("/")
def root():
    return send_file("../index.html")

@app.get("/healthz")
def health():
    return jsonify({"ok": True})

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)