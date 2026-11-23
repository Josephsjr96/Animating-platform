# Original-quality storyboard uploads

The application no longer rejects storyboard images because of their file size.
The former browser queue (15 MiB), Python scanner (15 MiB), platform Worker
(3 MiB), and vision Worker (3 MiB) caps were independent checks. The separate
thumbnail file picker also no longer rejects inputs over 10 MiB.

Single-page and queued scans send the original PNG, JPEG, or WebP file.
The platform checks its signature from the first 12 bytes, then transfers the
file stream to the private vision service. This avoids passing a large base64
string through the 32 MiB serialized RPC boundary. The vision service base64
encodes the stream without changing image bytes, resolution, or compression.
The model, prompts, inference budgets, frame detection, and review flow are
unchanged. Existing derived thumbnail previews retain their existing behavior.

This removes application file-size caps; it does not provide infinite capacity.
Cloudflare request, memory, and execution limits and the AI provider's input
limits still apply. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
and [RPC streaming](https://developers.cloudflare.com/workers/runtime-apis/rpc/#readablestream-writablestream-request-and-response).

## Validation

- `node tests/large-uploads.mjs`: inputs above 16 and 25 MiB reach mocked inference
  byte-for-byte; arbitrary stream boundaries preserve base64 encoding. Large PNG
  fixtures use trailing bytes to test transport, not model accuracy.
- `node tests/worker-vision-connection.mjs`: existing authentication, persistence,
  geometry, metadata, retry, and recovery coverage.
- `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/large-uploads-ui.mjs`:
  original bytes reach mocked HTTP scan endpoints from both single-file and
  queued browser flows. Serve this project at `http://127.0.0.1:4182` first.

## Deployment order

Deploy `workers/storyboard-vision` first: it adds the private `analyzeStream`
method while retaining `analyze` for compatibility with the existing platform.
Then deploy `workers/platform` and publish the website. Retain existing database,
service bindings, and secrets. Local validation does not establish successful
live model inference or deployment.
