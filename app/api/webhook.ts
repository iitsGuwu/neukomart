import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRedis, KEYS, ACTIVITY_CAP } from './_store';
import { decodeEvents } from './_decode';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Helius webhook ingest. Configure a Helius webhook (account/program address =
 * the NEUKO Market program) to POST raw transactions here. We decode the
 * program's Anchor events and upsert listings / offers / activity into Redis.
 *
 * Records store asset ids only; the frontend joins them with DAS metadata for
 * names/art, so the webhook stays fast.
 */

const SYSTEM = '11111111111111111111111111111111';
const cur = (c: number) => (c === 1 ? 'gboy' : 'sol');
const toUi = (amount: bigint, c: number) => Number(amount) / (c === 1 ? 1e10 : 1e9);

function extractLogs(tx: any): string[] {
  return (
    tx?.meta?.logMessages ||
    tx?.transaction?.meta?.logMessages ||
    tx?.logs ||
    []
  );
}
function sigOf(tx: any): string {
  return tx?.signature || tx?.transaction?.signatures?.[0] || tx?.transaction?.transaction?.signatures?.[0] || '';
}

/**
 * Constant-time secret comparison. Hashing both sides to a fixed 32-byte digest
 * before `timingSafeEqual` avoids the length-mismatch `RangeError` (which would
 * surface as a 500 and leak the secret's length) while keeping the comparison
 * resistant to timing side-channels.
 */
function safeEqual(a: string, b: string): boolean {
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  return timingSafeEqual(ah, bh);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const redis = getRedis();
  // No store configured → indexing is off; accept-and-ignore so setup is easy.
  if (!redis) return res.status(200).json({ ok: true, configured: false });

  // Fail closed: once the store is live, a shared secret is mandatory so nobody
  // can POST forged events and poison the indexer.
  const secret = process.env.HELIUS_WEBHOOK_SECRET;
  const authHeader = req.headers['authorization'];
  const provided = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!secret || !provided || !safeEqual(provided, secret)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const txs: any[] = Array.isArray(req.body) ? req.body : req.body?.transactions || [req.body];
  if (txs.length > 50) return res.status(413).json({ error: 'batch size too large' });
  let processed = 0;

  for (const tx of txs) {
    try {
      const events = decodeEvents(extractLogs(tx));
      if (!events.length) continue;
      const sig = sigOf(tx);
      const now = Math.floor(Date.now() / 1000);

      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        const eventId = `${sig}:${i}`;
        if (e.type === 'Listed') {
          await redis.hset(KEYS.listings, {
            [e.asset]: { asset: e.asset, seller: e.seller, price: toUi(e.price, e.currency), currency: cur(e.currency), createdAt: now, sig },
          });
          await pushActivity(redis, { id: eventId, kind: 'list', asset: e.asset, price: toUi(e.price, e.currency), currency: cur(e.currency), from: e.seller, time: now, sig });
        } else if (e.type === 'Sold') {
          await redis.hdel(KEYS.listings, e.asset);
          await pushActivity(redis, { id: eventId, kind: 'sale', asset: e.asset, price: toUi(e.price, e.currency), currency: cur(e.currency), from: e.seller, to: e.buyer, time: now, sig });
        } else if (e.type === 'OfferCreated') {
          await redis.hset(KEYS.offers, {
            [e.offer]: {
              id: e.offer,
              bidder: e.bidder,
              collection: e.collection,
              asset: e.asset === SYSTEM ? null : e.asset,
              amount: toUi(e.amount, e.currency),
              currency: cur(e.currency),
              createdAt: now,
              sig,
            },
          });
        } else if (e.type === 'OfferAccepted') {
          await redis.hdel(KEYS.offers, e.offer);
          await pushActivity(redis, { id: eventId, kind: 'sale', asset: e.asset, price: toUi(e.amount, e.currency), currency: cur(e.currency), from: e.seller, to: e.bidder, time: now, sig });
        } else if (e.type === 'SwapCreated') {
          await pushActivity(redis, { id: eventId, kind: 'swap', from: e.maker, time: now, sig });
        } else if (e.type === 'SwapAccepted') {
          await pushActivity(redis, { id: eventId, kind: 'swap', from: e.maker, to: e.taker, time: now, sig });
        }
        processed++;
      }
    } catch (err) {
      console.error('Failed to process tx', err);
    }
  }

  return res.status(200).json({ ok: true, processed });
}

async function pushActivity(redis: ReturnType<typeof getRedis>, item: Record<string, unknown>) {
  if (!redis) return;
  // @upstash/redis serializes objects to JSON automatically.
  await redis.lpush(KEYS.activity, item);
  await redis.ltrim(KEYS.activity, 0, ACTIVITY_CAP - 1);
}
