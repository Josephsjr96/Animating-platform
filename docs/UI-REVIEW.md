# Production workspace UI review

This checkout was cloned from `Josephsjr96/Animating-platform` before any edits. The original revision is recorded in `ui-baseline-commit.txt`. Work lives on `ui/production-workspace-polish`.

## Implemented

- A distinct slate and mint studio interface, responsive sidebar/mobile navigation, clearer typography, consistent controls, visible keyboard focus, and reduced-motion support.
- Shot list as the landing screen. Dashboard is retained under **Insights**; its original calculations and the milestones renderer are preserved.
- Search across shot numbers, descriptions, notes, dialogue, and elements. Status filtering, compact rows, a bounded scrolling sheet, and collapsible existing elements.
- Create up to 200 shots at once, choose numbering, insert after an existing shot, and start with no default elements. Shot numbers can be edited directly with duplicate protection.
- Select shot rows and set all their stage/element cells to an existing status. Full-cell status colors retain the backend's three existing status values.
- Independent PNG/JPEG/WebP thumbnail upload, with browser-side resizing to limit stored image size. Dialogue uses a full-height textarea.
- Lock/unlock shot ordering, drag by the handle, or use **Alt + Arrow Up/Down** on a handle. Existing shot IDs, cell keys, and order fields are retained.
- Year/month/week/day calendar views and a timeline grouped by stage or shot. Whole-shot due dates are included alongside element due dates. Calendar/timeline task links reveal the corresponding shot-list cell.
- A queue of up to 20 storyboard images, scanned sequentially through the existing one-file API. Each page opens in the original review and import wizard. Single-page scanning remains available.
- Imported workspace results cached by the original importer are adopted into UI memory so subsequent views use the imported data.
- Scan review and shot-list thumbnails accept raw base64, complete image data URLs, and HTTP(S) image URLs. When a scan returns pixel bounding boxes without crop data, previews are cropped from the uploaded page in the browser. Generated crops are saved into the existing thumbnail field after the original import, preserving reviewed panel selection and returned shot IDs. Missing or invalid coordinates are never guessed.

## Backend boundary

`server/`, `static/app.js`, `static/style.css`, and `.github/` are unchanged from the cloned revision. `index.html` adds only three resource references. The new CSS and JavaScript are an additive layer; removing those references restores the original UI.

No Worker deployment, migration, secret, production workspace, API URL, authentication method, request field, or existing API-client implementation was changed. The new scan queue calls the existing `API.scan(file)` one page at a time; review and commit still run through the original wizard. Workspace edits retain the original data structure and use the existing authenticated Cloudflare client through an additive synchronization adapter.

The original workspace persistence used same-origin `/api/workspace`, which does not reach Cloudflare on GitHub Pages. `static/workspace-sync.js` now routes workspace reads and writes through the same existing `API.getWorkspace` / `API.saveWorkspace` client used by imports. Requests retain the original API URLs, authentication header and workspace schema.

Opening an account performs no writes and does not populate the server with sample shots. Saves are serialized with immutable snapshots. Import commits wait for pending saves, temporarily prevent further UI edits, and adopt the returned workspace. Failed or offline edits are retained under a separate browser-storage key, with a **Download local backup** action. The adapter never automatically uploads an offline cache or merges it over the cloud workspace on reconnect. Cross-tab and multi-user concurrent editing remain outside this change; the existing whole-workspace API has no added revision control.

No production workspace key was needed or used for testing. A live unauthenticated OPTIONS request confirmed that the Worker permits GET/POST from `https://josephsjr96.github.io` with the existing `X-Workspace-Key` and `Content-Type` headers. This checks CORS, not authenticated scanning or persistence.

## PDF scope requiring separate work

The PDF also proposes real-time chat/video, multiple assignees per task, arbitrary spreadsheet tabs/columns, per-cell element hierarchies, a movable storyboard whiteboard, department metadata, and manually painted schedule blocks. These are not implemented as simulated UI features. Published is now a supported completed status in the shot-list editor, bulk actions, filters, and production metrics; the remaining features require additional data-model, service, or collaboration decisions beyond this frontend change. Scanner extraction semantics, including its treatment of descriptions, are unchanged.

## Validation

`tests/ui.mjs` uses Playwright with all `/api/` traffic intercepted, including Cloudflare requests. 52 browser checks exercise shot editing, status changes, thumbnails, ordering, scheduling, single-page UI preservation, batch scanning, original review/commit calls, and layout at 390, 768, 1024, and 1440 pixels. See `screenshots/validation.json` and the accompanying screenshots. This verifies frontend behavior and request compatibility with fixtures, not live OCR quality, live backend performance, or a production import.

Run a static preview with `python -m http.server 4182 --bind 127.0.0.1`. Then, with Playwright available:

```bash
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/ui.mjs
```

Tests default to `/usr/bin/chromium`; override `CHROMIUM_PATH` when needed. Five additional persistence tests cover no-write startup, ordered save snapshots, failure recovery, import/save ordering, and authentication fallback:

```bash
node tests/workspace-sync.mjs
```

No packages were added to the application.

The existing main-only GitHub Pages workflow publishes the frontend when this branch is merged. It does not deploy or modify the Cloudflare Worker.
