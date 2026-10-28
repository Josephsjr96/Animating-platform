# Shot-list thumbnail editor

Click an existing shot-list thumbnail, or focus it and press Enter/Space, to
open the crop editor. Empty thumbnails retain the upload picker. In the editor:

- Drag to select a crop, drag its lower-right corner to resize, or choose Move
  crop to reposition it. Exact pixel coordinates are also editable.
- Enlarge window grows both the dialog and image view; Normal window restores
  the smaller view. The dialog remains within the mobile viewport.
- Restore original selects the entire retained source thumbnail. Cancel and
  Escape discard edits. Replace image opens the existing image upload picker.
- Save thumbnail renders the selected pixels as PNG and uses the existing
  workspace save flow. If cloud saving fails, that flow retains a local copy.

Each edited shot retains `thumbnail_source` and `thumbnail_crop` alongside its
normal `thumbnail`, allowing later edits and restoration after reload. The
retained source is the thumbnail available at the first edit, not the original
storyboard page. Replacement clears those fields. Output uses at most 960 pixels
on its longest edge, matching the existing upload behavior. Cross-origin images
need permission to load for canvas editing; unavailable images offer replacement.
Retained sources count toward existing workspace storage limits.

`tests/shot-thumbnail-editor.mjs` verifies editing, enlarged image/window size,
invalid bounds, cancellation, exact crop pixels, cloud reload, source retention,
drag selection, keyboard/Escape, mobile bounds, restoration and image replacement.
All workspace requests are mocked. Existing thumbnail format, thumbnail import
and storyboard crop browser regressions also pass.
