# Local grouped-shot test milestone — 28 October 2026

Open **Animation Platform → Storyboard import** on the platform site.
Scan pages through the existing service, review each drawing, explicitly join groups
across pages, and correct duplicate shot numbers. Then choose **Import reviewed shots
locally**. Expand a shot under **Local imported shots** to see its ordered drawings,
crops, director actions, original notes and dialogue. Missing shot duration stays null;
panel timing is preserved inside each drawing and never summed.

**Restore review draft** accepts the JSON produced by **Download review draft**.
Choose the restored page in **Saved review page**, then **Open saved review** to edit.
Keep downloaded drafts as backups, especially for large storyboard scans. Restore
merges pages by scan import ID, replacing matching saved pages. Invalid files leave
saved data intact.

Local import uses a separate versioned library (`nuvren-storyboard-shots-v1`), not
the cloud-synced production dashboard. All saved review pages are imported together.
Reimport replaces library shots touching those pages in one storage write, so retries,
grouping and splitting do not add duplicates. Duplicate nonblank shot numbers across
separate groups are blocked. Blank numbers are permitted for manual review.

This is a local test milestone, not completion of the production storage migration.
The gallery is read-only; edit grouping/notes in saved review and reimport. Cover
selection, manual drawing order, project/account scope, multiple-tab conflict handling,
discard controls, shot-level description/timing editing, and integration into the main
shot table remain future work. Data is per browser origin; scans still require the
existing service and allowed-origin setup. No backend, agent, production data or
GitHub deployment was changed. Tonight's real storyboard interpretation remains to
be tested with the animator.

Verification: production build and browser tests for grouping/recovery, local import,
file restore, cross-page preservation, retry behavior, duplicate rejection, invalid
file rejection, and workspace navigation. Tests intercept API traffic and verify zero
cloud writes from local review/import.

Platform regression command (serve this repository locally first):

```bash
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs UI_TEST_URL=http://127.0.0.1:4182 node tests/local-grouped-shots.mjs
```
