import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Server-side proxy for the Magic Eden public API (no CORS headers of its own,
 * and a shared egress IP benefits from one retry layer). Mirrors the Vite dev
 * proxy at `/api/magiceden`.
 *
 *   /api/magiceden/v2/collections/harmies/listings?...  ->
 *   https://api-mainnet.magiceden.dev/v2/collections/harmies/listings?...
 *
 * Only allow-listed path prefixes are forwarded to prevent this endpoint from
 * being used as a general-purpose HTTP relay (H-3).
 */
const ME = 'https://api-mainnet.magiceden.dev';

/** Paths the app actually needs — anything else is rejected with 403. */
const ALLOWED_PREFIXES = ['v2/collections/'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  const segs = req.query.path;
  const segArr = Array.isArray(segs) ? segs : segs != null ? [String(segs)] : [];

  // Reject path-traversal / separator tricks before anything else: a segment of
  // ".."/"." (or one smuggling its own separators) would let `fetch` normalize
  // the URL back out of the allow-listed prefix and onto other ME endpoints.
  if (segArr.some((s) => s === '..' || s === '.' || s.includes('/') || s.includes('\\') || s.includes('%2e') || s.includes('%2f'))) {
    return res.status(400).json({ error: 'invalid path' });
  }
  const path = segArr.join('/');

  // H-3: Only allow access to known ME API path prefixes.
  const isAllowed = ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
  if (!isAllowed) {
    return res.status(403).json({ error: 'path not allowed' });
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k === 'path') continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else if (v != null) qs.set(k, String(v));
  }
  const url = `${ME}/${path}${qs.toString() ? `?${qs}` : ''}`;

  let upstream: Response | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      upstream = await fetch(url, { headers: { accept: 'application/json' } });
    } catch {
      if (attempt === 4) return res.status(502).json({ error: 'upstream error' });
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (upstream.status !== 429 && upstream.status !== 503) break;
    if (attempt === 4) break;
    await sleep(500 * 2 ** attempt + Math.random() * 300);
  }

  if (!upstream) return res.status(502).json({ error: 'no response' });
  const body = await upstream.text();
  res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=120');
  res.setHeader('content-type', 'application/json');
  return res.status(upstream.status).send(body);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
