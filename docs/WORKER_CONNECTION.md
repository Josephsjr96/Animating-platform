# Platform and storyboard vision connection

The GitHub Pages frontend sends authenticated imports to `animating-platform`.
That Worker now calls the dedicated `animating-storyboard-vision` through the
`STORYBOARD_VISION` service binding and its named `StoryboardService` entrypoint.
The vision model is Qwen (`@cf/qwen/qwen3.8-27b`), restored from the earlier
platform scanner. Images are sent as `image_url` parts alongside the text prompt,
with low reasoning effort and a 2,400-token completion limit. The interpreter reads
Qwen's `choices[0].message.content` output and retains support for `response`/`result`
text envelopes. The storyboard prompt and public Bearer-token authentication are retained.
The private entrypoint invokes the same interpreter using its existing secret;
no credentials are embedded in this repository or sent to the browser.

Source was recovered from both live Workers before the change. `workers/platform`
contains the existing D1 workspace/import implementation plus the connection adapter.
`workers/storyboard-vision` contains the existing interpreter plus the private entrypoint.
No database schema changes or workspace migrations were made.

## Builds

The platform Cloudflare build root is `/workers/platform`. Build command:
`node ../../tests/worker-vision-connection.mjs`. Deploy command:
`npx --yes wrangler@4.153.0 deploy`. Only Worker source/connection test changes
trigger this build; website-only edits continue through GitHub Pages.
This replaces `npx wrangler preview` at repository root, which installed unrelated
Python dependencies and then failed because no previews configuration existed.

Deploy the vision Worker separately from `workers/storyboard-vision` after running
the connection tests. Deploy vision before platform when changing the RPC contract.
Keep existing `VISION_API_TOKEN` and `WORKSPACE_ACCESS_KEY` secrets in Cloudflare;
they must never be added to Wrangler vars or committed. The platform continues to use
its existing D1 database and workspace key. The Python reference scanner is separate
and is not used by this live route.

## Verification

`node tests/worker-vision-connection.mjs` uses mocked inference and D1 to verify routing,
authentication, Japanese notes, missing timing, persistence and upstream errors.
It also checks Qwen image inputs, chat-completion output, legacy text output,
fenced JSON, and review-required errors for invalid or empty model responses.
`GET https://animating-platform.josephsanjari1996.workers.dev/healthz` calls the bound
vision health method without inference and reports the connected service/model.
Public unauthenticated `POST /analyze` on vision must still return 401.

Live health and unauthorized-request checks passed on 28 October 2026. Full accuracy,
model availability during inference, and real authenticated storyboard scans still
need the animator's test. Health success alone does not validate model inference.
