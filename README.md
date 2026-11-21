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
## Local grouped storyboard shots

Grouped-shot import, drawing galleries and draft-file restoration are available locally. See [testing instructions and limitations](docs/LOCAL_GROUPED_SHOTS_2026-10-28.md).

## Team task board and Gantt planner — 21 November 2026

Open **Timeline** to switch between **Gantt** and **Board**. Add a task with the inline title field and one submit; column add forms create unscheduled tasks in that status. Existing shot-list tasks remain linked to their original cells. New project tasks are stored separately in `productionTasks`, using the existing workspace save flow.

- Cards and Gantt rows display the department selector. Click **!** to see members with unfinished assignments in that department and change the task owner; the task editor also supports assignment.
- Add named teams and select their colors with **Team colors**. Pipeline stages are also available as colored teams. Team definitions persist in `productionTeams`; stage colors persist on stage records.
- Drag cards between status columns. Status selectors provide a keyboard alternative.
- Set start/due dates in the task editor. Gantt bars show inclusive multi-day ranges; dragging a bar reschedules it while preserving its duration. Date fields provide a keyboard alternative.
- Click an empty day to open a creation form with its date and team prefilled. Filter by team/person, search tasks and people, and group Gantt rows by team, shot or stage.
- Day grids are bounded to four or twelve weeks with previous/next/Today navigation. The board and Gantt scroll within mobile layouts.

Task storage retains title, notes, assignment, team, status, start/due dates and completion timestamps. No backend routes changed. Validation used mocked API traffic, not production writes. Website publication uses the existing GitHub Pages workflow. Backend Workers are unchanged, and the separately audited synchronization bugs remain outside this change.

Priorities are recorded in `docs/USER_PRIORITIES_2026-11-21.json`; the spreadsheet-based shot-grid redesign remains queued.

```bash
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs UI_TEST_URL=http://127.0.0.1:4182 node tests/task-planner.mjs
```

### Task-creation correction

**Add task** now opens a creation form when the inline title is empty; typed titles still submit directly. Empty Gantt days and empty team rows open that form directly. Cancel keeps the workspace unchanged. The direct Gantt link waits for the workspace load before exposing editable tasks, and task IDs have a fallback for browsers without `crypto.randomUUID`.

Validation: 25 planner checks, a delayed-load/empty-workspace/browser-ID regression, and 52 existing UI checks passed with mocked APIs. Run the additional regression with `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/planner-startup.mjs`.

### Department planning and rendering correction

Creating from a Gantt day preserves that day, department and visible date range. Occupied day cells and bars use the department color. The **!** control lists members with unfinished assignments across the department (including tasks outside the visible page); completed tasks do not count as active work.

Gantt pages show 50 tasks and board columns initially show 25 cards with **Show more**. Search covers the full workspace, keeps input focus, and updates results after a short debounce. Planner edits preserve draft titles and scroll positions while updating the planner region.

Validation: 31 planner checks, startup regression and a 1,000-task rendering regression passed with mocked APIs. The local Chromium fixture reduced synchronous render/layout from 2,663 ms and 66,283 DOM elements to 117 ms and 1,062 elements; these are local fixture measurements, not production timings. Run `tests/planner-performance.mjs` with `PLAYWRIGHT_MODULE` set to repeat the bounded-rendering, pagination, search and draft checks.
