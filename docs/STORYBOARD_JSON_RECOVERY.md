# Storyboard JSON and frame recovery — 28 October 2026

Review validates each included drawing before making an import request. Missing
cut numbers or nonpositive/unknown durations display an inline message listing
the drawings and focus the first missing field, including drawings previously
hidden by the confidence filter. Unknown timing stays blank; fractional seconds
are supported. Skipped drawings do not require metadata.

Border detection checks aligned closing-border candidates rather than giving up
at the next horizontal stroke. Nearly full-width frames are supported. Tests
cover seven ruled frames, an unrelated internal horizontal rule, and wide frames,
as well as the existing count and empty-page checks. These are synthetic layout
regressions, not proof of accuracy on every scanned page.

Detected frame boxes remain immutable during inference. The model independently
checks the whole page for omitted drawings and may suggest `additional_panels`.
Those boxes are labeled estimated, checked against source dimensions and rejected
when they substantially overlap detected frames or other accepted suggestions.
All crops and metadata require review. A seven-frame result is not automatically
seven shots: grouping remains a separate review decision.

Malformed, truncated or wrong-shaped JSON is retried once. Text content blocks
and legacy response envelopes are supported. If both attempts fail but bordered
frames exist, the service returns those frames with blank metadata, zero
confidence and an explicit warning. It never salvages metadata from truncated
JSON. Without detected frames it returns an actionable error rather than making
up boxes. Inference failures follow the same bounded retry/review path.

`node tests/worker-vision-connection.mjs` verifies seven-frame preservation, six
metadata readings for seven frames, recovery of a seventh model-suggested frame,
duplicate/out-of-bounds rejection and warning forwarding through the platform.
Browser tests `tests/import-review-validation.mjs` and
`tests/seven-frame-recovery.mjs` verify review, focus, blank timing, warnings and
import gating with mocked APIs. Existing crop and grouped-shot tests also apply.

Publish the vision Worker, then the platform Worker, then the GitHub Pages
frontend. Existing secrets/bindings and database schemas are retained. Upload
limits remain 3 MB in the live services; this change does not increase them.
The exact user-reported seven-frame page still needs a source image for replay.
