# Next.js PPR resume: gzip request body not decompressed → "Invariant: invalid postponed state"

## Summary

On a **PPR (Cache Components) resume**, Next reads the postponed state from the
**POST request body** and decodes it with `body.toString("utf8")` **without
honoring `Content-Encoding`**. When the resume body arrives **gzip-compressed**
(as it does behind Vercel's infrastructure), the gzip bytes decoded as UTF-8 are
not a valid postponed-state string, so `parsePostponedState` throws:

```
Invariant: invalid postponed state <gzip garbage>   (error code E314)
```

The garbage starts with the gzip magic header `1f 8b 08`. `parsePostponedState`
catches its own throw, logs `Failed to parse postponed state` + the Invariant,
and **degrades to `type:1`** — so it surfaces as a **logged server error with an
HTTP 200** (the page falls back), which is exactly what production shows.

This fires on **every `◐ PARTIALLY_STATIC` route that is resumed** (cart,
checkout, category/content pages, …), as a recovered `200` but a logged server
error, and (when the `Z_BUF_ERROR` path is hit) as a hard failure. It is not
client/deployment skew and not attacker input — a clean gzip header is the
legitimate resume body.

## Affected

- **Not a regression — pre-existing.** The resume-body read path
  (`base-server.js` `body.toString('utf8')` with no `Content-Encoding`
  decompression) is **byte-for-byte identical in `16.2.6` and `16.3`**, so this
  reproduces on both. This repo pins `16.3.0-preview.5` (also `16.3.0-canary.*`)
  for convenience; the same code path exists in the 16.2.x line.
- Requires `cacheComponents: true` (PPR) and a route that produces a postponed
  state (`◐ Partial Prerender`).
- Only manifests where the resume body is gzip-encoded — i.e. **minimal mode**
  (what Vercel runs). Plain `next start` resumes in-process and never decodes a
  request body, which is why it does not reproduce locally by default.

## Root cause (code path)

`next/dist/server/base-server.js` — on a resume request:

```js
if (this.isAppPPREnabled && this.minimalMode &&
    req.headers[NEXT_RESUME_HEADER] === '1' && req.method === 'POST') {
  const body = await readBodyWithSizeLimit(req.body, maxPostponedStateSizeBytes);
  const postponed = body.toString('utf8');            // <-- no gzip decompression
  addRequestMeta(req, 'postponed', postponed);
}
```

`readBodyWithSizeLimit` (`next/dist/server/lib/postponed-request-body.js`) simply
concatenates the raw chunks; there is no `Content-Encoding` handling. The
`postponed` string then flows to `parsePostponedState`
(`next/dist/server/app-render/postponed-state.js`, called at
`app-render.js`), which requires the state to start with `^<digits>:` and throws
`E314` otherwise.

## Reproduce

```bash
npm install

# (1) Deterministic, server-free proof — this is the authoritative repro.
npm run repro:unit
#   -> gzip header "1f 8b 08 .." and the byte-identical production log line:
#      "Failed to parse postponed state Error: Invariant: invalid postponed state <gzip>"
#      then degrades to type:1 (logged, HTTP 200).

# (2) Optional end-to-end attempt (minimal mode + gzip resume request).
npm run build      # the route prints as ◐ (Partial Prerender)
npm run repro
```

**Note on (2):** the resume render path that calls `parsePostponedState` is
driven by Vercel-internal routing (the prerender manifest, RSC/resume contract),
so a bare `next start` with `NEXT_PRIVATE_MINIMAL_MODE=1` may not exercise it
(the requests return 200 without reaching the parser). The **unit repro (1) is
the authoritative, environment-independent proof** — it calls the installed
`parsePostponedState` exactly as `base-server.js` does and produces the exact
production log. The code-path trace below is the rest of the evidence.

## Expected vs actual

- **Expected:** Next decompresses the resume request body according to its
  `Content-Encoding` (or the resume client and server agree on the encoding)
  before parsing the postponed state.
- **Actual:** the gzip bytes are decoded as UTF-8 and parsed as-is;
  `parsePostponedState` logs `Failed to parse postponed state: Invariant: invalid
  postponed state <gzip>` and degrades to `type:1`, so the route cannot resume
  its prerendered HTML (logged error, HTTP 200 fallback).

## Suggested fix

In the resume-body read path (`base-server.js`), decompress before
`toString("utf8")` — mirroring how the `renderResumeDataCache` portion is
already gunzipped downstream.

Note the PPR resume "chain" contract emitted by the build
(`generate-routes-manifest.ts` / `build-complete.ts`) only sets
`{ headers: { 'next-resume': '1' } }` — it carries **no `Content-Encoding`**,
and nothing in the OSS tree gzips the resume body. The compression is applied
by the infrastructure that issues the chained resume request (e.g. Vercel's
router), so a fix that relies solely on a forwarded `Content-Encoding` header
may be a no-op in production. A robust fix honors `Content-Encoding` when
present **and** detects the leading gzip magic number (`0x1f 0x8b`) when it is
not — which is safe because a valid serialized postponed state always begins
with `<len>:` (`0x30`–`0x3a`), so there is no overlap.

A candidate patch implementing exactly this is in the linked PR.

## Workaround

Make the affected routes fully dynamic (`ƒ`) so there is no postponed state to
resume — e.g. `await connection()` at the page root (16.3 only; 16.2.6 rejects
both `connection()` outside Suspense and `export const dynamic`). This trades
away the static shell, so it is only viable for session-specific routes
(cart/checkout), not cacheable catalog/content pages.
