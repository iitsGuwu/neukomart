import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Server-side proxy for Tensor's GraphQL buy transaction API.
 *
 * Tensor's marketplace program requires their co-signature embedded in the
 * transaction, obtained via their GraphQL API. The API key is held server-side.
 *
 * Usage:
 *   GET /api/tensor-buy?buyer=<pk>&owner=<pk>&mint=<pk>&price=<lamports>
 *
 * `price` is in lamports (integer) matching Tensor's internal representation.
 *
 * Returns { txV0: { data: number[] } } on success.
 * Returns { error: string } on failure (200 status for "not configured" so the
 * client knows to redirect instead of treating it as a hard error).
 */

const TENSOR_GRAPHQL = 'https://api.mainnet.tensordev.io/graphql';

/** Base58 pubkey validation. */
const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Lamports — positive integer, up to 10^12 (1000 SOL). */
const LAMPORTS_RE = /^\d{1,12}$/;

function isValidPubkey(s: string): boolean {
  return PUBKEY_RE.test(s);
}
function isValidLamports(s: string): boolean {
  if (!LAMPORTS_RE.test(s)) return false;
  const n = parseInt(s, 10);
  return n > 0 && n < 1_000_000_000_000;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// GraphQL query for buying a single listed NFT via Tensor's TSWAP/TCOMP program.
const BUY_QUERY = `
  query TswapBuySingleListingTx(
    $buyer: String!
    $mint: String!
    $price: Decimal!
    $owner: String!
  ) {
    tswapBuySingleListingTx(
      buyer: $buyer
      mint: $mint
      price: $price
      owner: $owner
    ) {
      txV0 {
        data
      }
    }
  }
`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  const apiKey = process.env.TENSOR_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ error: 'not configured' });
  }

  // Validate parameters.
  const { buyer, owner, mint, price } = (req.query || {}) as Record<string, string | undefined>;
  if (!buyer || !isValidPubkey(buyer)) return res.status(400).json({ error: 'invalid buyer' });
  if (!owner || !isValidPubkey(owner)) return res.status(400).json({ error: 'invalid owner (seller)' });
  if (!mint || !isValidPubkey(mint)) return res.status(400).json({ error: 'invalid mint' });
  if (!price || !isValidLamports(price)) return res.status(400).json({ error: 'invalid price (lamports)' });

  // Tensor uses decimal representation for price in GraphQL (in lamports).
  const variables = { buyer, mint, price, owner };

  let upstream: Response | null = null;
  for (let i = 0; i < 4; i++) {
    try {
      upstream = await fetch(TENSOR_GRAPHQL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tensor-api-key': apiKey,
        },
        body: JSON.stringify({ query: BUY_QUERY, variables }),
      });
    } catch {
      if (i === 3) return res.status(502).json({ error: 'upstream error' });
      await sleep(500 * 2 ** i);
      continue;
    }
    if (upstream.status !== 429) break;
    if (i === 3) break;
    await sleep(500 * 2 ** i + Math.random() * 200);
  }

  if (!upstream) return res.status(502).json({ error: 'no response' });

  const json = await upstream.json() as {
    data?: { tswapBuySingleListingTx?: { txV0?: { data: number[] } } };
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    return res.status(200).json({ error: json.errors[0].message });
  }

  const txData = json.data?.tswapBuySingleListingTx?.txV0;
  if (!txData) {
    return res.status(200).json({ error: 'no transaction returned' });
  }

  res.setHeader('content-type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ txV0: txData });
}
