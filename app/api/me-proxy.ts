import type { VercelRequest, VercelResponse } from '@vercel/node';
import https from 'https';

/**
 * Server-side proxy for the Magic Eden public API (it sends no CORS headers of
 * its own, and a shared egress IP benefits from one retry layer).
 *
 * This version uses the native Node 'https' module to ensure full compatibility
 * across all Node.js runtime versions on Vercel without relying on global 'fetch'.
 */
const ME = 'https://api-mainnet.magiceden.dev';

/** Paths the app actually needs — anything else is rejected with 403. */
const ALLOWED_PREFIXES = ['v2/collections/'];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface HttpsResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function httpsGet(url: string, headers: Record<string, string>): Promise<HttpsResponse> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 500,
          headers: res.headers,
          body: data,
        });
      });
    });
    req.on('error', (err) => {
      reject(err);
    });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  // `p` is the Magic Eden path, set by the vercel.json rewrite (`:path*` -> p).
  // Tolerate either a slash-joined string or an array of segments.
  const rawP = req.query?.p;
  const path = Array.isArray(rawP) ? rawP.join('/') : rawP != null ? String(rawP) : '';
  const segArr = path.split('/');

  // Reject path-traversal / separator tricks before anything else: a segment of
  // ".."/"."/empty (or one smuggling its own separators) would let `httpsGet`
  // normalize the URL back out of the allow-listed prefix onto other endpoints.
  if (
    !path ||
    segArr.some(
      (s) => s === '' || s === '.' || s === '..' || s.includes('\\') || s.includes('%2e') || s.includes('%2f'),
    )
  ) {
    return res.status(400).json({ error: 'invalid path' });
  }

  // Only allow access to known ME API path prefixes.
  if (!ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return res.status(403).json({ error: 'path not allowed' });
  }

  // Forward every query param except our internal `p`.
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query || {})) {
    if (k === 'p') continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else if (v != null) qs.set(k, String(v));
  }
  const url = `${ME}/${path}${qs.toString() ? `?${qs}` : ''}`;

  let upstream: HttpsResponse | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      upstream = await httpsGet(url, {
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
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
  res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=120');
  res.setHeader('content-type', 'application/json');
  return res.status(upstream.status).send(upstream.body);
}
