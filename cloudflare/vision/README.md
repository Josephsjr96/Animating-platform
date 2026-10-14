# Separate Japanese storyboard vision Worker

This service uses **Cloudflare Workers AI** and does not alter the existing
`flat-waterfall-436c` DeepSeek chat proxy.

## Deploy

From `cloudflare/vision`:

```sh
npx wrangler deploy
npx wrangler secret put VISION_API_TOKEN
```

Cloudflare may require accepting the Llama 3.2 Vision model license in the dashboard before inference succeeds.

The caller must send a server-side Bearer token:

```sh
curl -X POST 'https://animating-storyboard-vision.josephsanjari1996.workers.dev/analyze' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_SECRET_TOKEN' \
  --data '{"image_b64":"BASE64_IMAGE","template":"default"}'
```

Input JSON: `image_b64` (base64 PNG, JPEG or WEBP, maximum 3 MiB), optional `template`.
The output is `panels` with `bbox` in original image pixels and **uncertain metadata that requires manual review**.

The vision model's geometric coordinates are predictions, not precision guarantees.
Review and adjust every crop before importing. If the model returns prose or no valid
boxes, the API fails explicitly rather than pretending to scan successfully.

**Do not put VISION_API_TOKEN in GitHub Pages JavaScript.** Use the authenticated
application API/backend as a server-side proxy. Flask's `AGENT_URL` /
`AGENT_TOKEN` configuration can invoke this service server-side after deployment.
The current read-only staging Worker cannot do this yet.

`GET /healthz` reports whether an AI binding and secret are configured without
revealing the secret. The service is not automatically connected to the public site.
