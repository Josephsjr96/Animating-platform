# Storyboard crop boundaries

The browser detects straight, dark frame borders in the original upload before
scanning. It pairs neighboring horizontal borders only when both side borders
cover at least 85% of the intervening height. Crops use the inner border pixels.
This targets ruled storyboard templates; it does not guarantee detection of
rotated, faint, irregular or borderless artwork. Detection skips images over
24 million pixels; their estimated crops remain manually adjustable.

The existing scan form now includes optional `geometry` with the original width,
height and frame rectangles. The platform passes it to the private vision service.
The service validates the bounds and gives Qwen numbered frame rectangles. Qwen
reads metadata by `frame_index`; its proposed rectangles cannot replace detected
borders. Indexed metadata uses a strict JSON schema with required frame IDs.
Missing or ambiguous frame metadata is left blank with zero confidence.
Without reliable borders, model rectangles are labeled estimated and checked
against supplied image dimensions. All results still require review. More than
25 detected drawings prompts the user to split the page; the existing service cap
has not been increased.

In review, **Edit thumbnail** displays the original upload with all rectangles.
Move the selected box, resize its lower-right corner, or enter exact pixel bounds.
The mini editor also rotates in 90-degree steps, flips horizontally/vertically,
and adjusts brightness, contrast and saturation with a live thumbnail preview.
**Restore original** resets the crop and adjustments; Cancel discards the session.
Edits are non-destructive: the original page and scanned text are preserved.
Saving changes only that drawing and regenerates its thumbnail. Bounds cannot
leave the source image. Cancel keeps the accepted crop. Corrections are retained
in local review drafts and used by the existing thumbnail-save adapter after a
single-panel cloud import. Grouped-shot cloud import remains separate unfinished
work. Restored drafts lack their original image and must be rescanned to adjust.

Deploy vision before platform, then publish the frontend. Old clients remain
compatible because geometry is optional. No login, workspace schema, assignment,
calendar, timeline or upload-size changes are included.

Checks:

- `node tests/storyboard-geometry.mjs`: exact inner bounds, variable frame counts,
  blank pages, borderless horizontal-line rejection.
- `node tests/worker-vision-connection.mjs`: forwarding, bounds validation,
  immutable detected rectangles, indexed metadata and blank fallback.
- `tests/storyboard-crop-review.mjs` (Playwright): queued scans, geometry upload,
  numeric adjustment, invalid bounds, cancel, local draft persistence and correct
  crop pixels after cloud-save/reload with mocked API requests.
- Existing thumbnail import and grouped-review regressions.

The earlier 490×743 WebP sample returned all five framed drawings in browser
testing. A live Qwen call with the indexed schema returned five items with frame
IDs 0–4. This is sample evidence, not validation of all storyboard layouts or
Japanese handwriting accuracy.
