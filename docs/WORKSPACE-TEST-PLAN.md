# Workspace implementation and verification plan

## Current implementation
- Flask + SQLite workspace, browser UI and storyboard import wizard.
- Calendar is the default landing view; assignments derive from the shot-stage cells.
- Japanese e-konte import prefers the configured vision worker, validates returned artwork bounding boxes, and requires human review. Local OpenCV geometry fallback **does not** recognize Japanese handwriting.
- No production Blender connection has been implemented.

## Storyboard acceptance test (use the supplied five-panel e-konte sheet)
1. Launch from repository root: `python server/app.py`; open `http://localhost:5000`.
2. Confirm `GET /healthz` succeeds and `/static/app.js` loads.
3. Upload the Japanese storyboard image. Expect a response with `panels`, `source`, `needs_review`, and pixel bounding boxes.
4. Visually compare each crop to the original artwork. Verify the right notes column is not included in thumbnails.
5. Confirm Japanese notes are preserved, not transliterated or invented; unknown cut numbers/durations stay blank.
6. Complete the review fields and import. Confirm thumbnails survive and the shot list updates.
7. Repeat the same commit; expect HTTP 409. Review incomplete data; expect HTTP 400.
8. Disable the worker and repeat: local geometry-only detection may miss panels; do not treat this as Japanese handwriting recognition.

## Known limitations and next engineering milestones
- The remote worker's `/analyze` API must support the instructed JSON response schema. Sending instructions alone does not prove it uses a vision-capable model.
- Provide explicit region editor and multi-panel cut grouping in the review wizard; do not equate illustrated panels with unique cuts.
- Calendar: add week/day modes, filters by assignee/department, drag-and-drop rescheduling with undo, dependency conflict warnings, and accessible keyboard editing.
- Implement scheduling dependencies with cycle detection, immutable change proposals, and tests before automatic cascading date updates.
- Add a Blender add-on and a narrowly scoped authenticated bridge API: scene metadata, shot links, render status, and launch/deep links. Do not run arbitrary Python from browser requests.
- Improve save conflict handling and optimistic UI: current last-write-wins JSON storage can overwrite concurrent edits.
- Verify on real devices and run automated browser tests before merging.

## Safety and security
- Protect import and workspace APIs with authentication before public deployment.
- Restrict upload types by decoding, cap pixels and file size, and remove uploads on failed processing.
- Avoid untrusted HTML insertion and unescaped remote metadata in the browser.
- Keep worker token server-side and configure the URL explicitly per environment.
