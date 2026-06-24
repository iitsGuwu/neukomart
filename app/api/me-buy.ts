import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Server-side proxy for the Magic Eden `buy_now` instruction API.
 *
 * ME's marketplace program requires their co-signature embedded in the
 * transaction — this is obtained server-side using the ME API key so the key
 * is never exposed to the browser.
 *
 * Usage:
 *   GET /api/me-buy?buyer=<pk>&seller=<pk>&mint=<pk>&price=<sol>
 *
 * Returns the raw ME JSON: { tx: { type:"Buffer", data:[...] } }
 * On error returns { error: string }. A 200 with { error: "not configured" }
 * signals the client to fall back to redirect behaviour.
 */

const ME_BUY_URL = 'https://api-mainnet.magiceden.dev/v2/instructions/buy_now';

/** Base58 pubkey — 32–44 base58 chars (no path separators). */
const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** SOL price — positive finite decimal up to 10^6 (well above any realistic NFT). */
const PRICE_RE = /^\d{1,9}(\.\d{1,9})?$/;

function isValidPubkey(s: string): boolean {
  return PUBKEY_RE.test(s);
}
function isValidPrice(s: string): boolean {
  if (!PRICE_RE.test(s)) return false;
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 && n < 1_000_000;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only GET — the ME instruction API is a GET endpoint.
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  // Must be configured with an ME API key.
  const apiKey = process.env.ME_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ error: 'not configured' });
  }

  // Validate and extract parameters.
  const { buyer, seller, mint, price } = req.query as Record<string, string | undefined>;
  if (!buyer || !isValidPubkey(buyer)) return res.status(400).json({ error: 'invalid buyer' });
  if (!seller || !isValidPubkey(seller)) return res.status(400).json({ error: 'invalid seller' });
  if (!mint || !isValidPubkey(mint)) return res.status(400).json({ error: 'invalid mint' });
  if (!price || !isValidPrice(price)) return res.status(400).json({ error: 'invalid price' });

  // Build the ME instruction URL.
  // For Metaplex Core assets, the tokenATA is the asset address itself (no SPL token account).
  const qs = new URLSearchParams({
    buyer,
    seller,
    tokenMint: mint,
    tokenATA: mint, // Core assets: asset address used directly
    price,
    sellerExpiry: '0',
  });
  const url = `${ME_BUY_URL}?${qs}`;

  // Fetch with retry on rate-limit.
  let upstream: Response | null = null;
  for (let i = 0; i < 4; i++) {
    try {
      upstream = await fetch(url, {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
      });
    } catch {
      if (i === 3) return res.status(502).json({ error: 'upstream error' });
      await sleep(500 * 2 ** i);
      continue;
    }
    if (upstream.status !== 429) break;
    if (i === 3) break;
    const ra = parseInt(upstream.headers.get('Retry-After') || '', 10);
    await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 500 * 2 ** i + Math.random() * 200);
  }

  if (!upstream) return res.status(502).json({ error: 'no response' });

  // Pass upstream status + body through verbatim (ME errors are meaningful JSON).
  const body = await upstream.text();
  res.setHeader('content-type', 'application/json');
  // No caching — buy instructions are single-use (blockhash-bound).
  res.setHeader('Cache-Control', 'no-store');
  return res.status(upstream.status).send(body);
}
