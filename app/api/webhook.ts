import type { VercelRequest, VercelResponse } from '@vercel/node';
import bs58 from 'bs58';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Helius webhook ingest. Configure a Helius webhook (account/program address =
 * the NEUKO Market program) to POST raw transactions here. We decode the
 * program's Anchor events and upsert listings / offers / activity into Redis.
 *
 * Everything is INLINED (no `./_store` / `./_decode` imports): an
 * underscore-prefixed shared module in `api/` does not resolve in Vercel's
 * bundled ESM function runtime ("Cannot find module" / FUNCTION_INVOCATION_FAILED
 * on every POST), which silently disabled the indexer write path. `@upstash/redis`
 * is loaded dynamically inside the handler (the pattern proven to work); other
 * node-module imports (bs58, node:crypto) resolve fine.
 */

const KEYS = {
  listings: 'neuko:listings',
  offers: 'neuko:offers',
  activity: 'neuko:activity',
} as const;
const ACTIVITY_CAP = 500;
const SYSTEM = '11111111111111111111111111111111';

const cur = (c: number) => (c === 1 ? 'gboy' : 'sol');
const toUi = (amount: bigint, c: number) => Number(amount) / (c === 1 ? 1e10 : 1e9);

// ---- event decoding (inlined from _decode) --------------------------------

const DISC = {
  Listed: [243, 173, 136, 195, 125, 241, 12, 99],
  Sold: [205, 203, 210, 202, 96, 11, 192, 10],
  SwapCreated: [95, 3, 86, 52, 73, 22, 116, 203],
  SwapAccepted: [226, 86, 141, 186, 157, 59, 108, 143],
  OfferCreated: [31, 236, 215, 144, 75, 45, 157, 87],
  OfferAccepted: [81, 238, 238, 115, 140, 18, 8, 20],
};

function matches(buf: Buffer, disc: number[]): boolean {
  return disc.every((b, i) => buf[i] === b);
}

class Reader {
  off = 8; // skip discriminator
  constructor(private buf: Buffer) {}
  pubkey(): string {
    if (this.off + 32 > this.buf.length) throw new Error('Buffer underflow');
    const b = this.buf.subarray(this.off, this.off + 32);
    this.off += 32;
    return bs58.encode(b);
  }
  u64(): bigint {
    if (this.off + 8 > this.buf.length) throw new Error('Buffer underflow');
    const v = this.buf.readBigUInt64LE(this.off);
    this.off += 8;
    return v;
  }
  u8(): number {
    if (this.off + 1 > this.buf.length) throw new Error('Buffer underflow');
    return this.buf[this.off++];
  }
}

type DecodedEvent =
  | { type: 'Listed'; asset: string; seller: string; price: bigint; currency: number }
  | { type: 'Sold'; asset: string; seller: string; buyer: string; price: bigint; currency: number }
  | { type: 'SwapCreated'; swap: string; maker: string }
  | { type: 'SwapAccepted'; swap: string; maker: string; taker: string }
  | { type: 'OfferCreated'; offer: string; bidder: string; collection: string; asset: string; amount: bigint; currency: number }
  | { type: 'OfferAccepted'; offer: string; bidder: string; seller: string; asset: string; amount: bigint; currency: number };

function decodeEvents(logs: string[]): DecodedEvent[] {
  const out: DecodedEvent[] = [];
  for (const line of logs) {
    if (!line.startsWith('Program data: ')) continue;
    let buf: Buffer;
    try {
      buf = Buffer.from(line.slice('Program data: '.length), 'base64');
    } catch {
      continue;
    }
    if (buf.length < 8) continue;
    try {
      if (matches(buf, DISC.Listed)) {
        const r = new Reader(buf);
        out.push({ type: 'Listed', asset: r.pubkey(), seller: r.pubkey(), price: r.u64(), currency: r.u8() });
      } else if (matches(buf, DISC.Sold)) {
        const r = new Reader(buf);
        out.push({ type: 'Sold', asset: r.pubkey(), seller: r.pubkey(), buyer: r.pubkey(), price: r.u64(), currency: r.u8() });
      } else if (matches(buf, DISC.SwapCreated)) {
        const r = new Reader(buf);
        out.push({ type: 'SwapCreated', swap: r.pubkey(), maker: r.pubkey() });
      } else if (matches(buf, DISC.SwapAccepted)) {
        const r = new Reader(buf);
        out.push({ type: 'SwapAccepted', swap: r.pubkey(), maker: r.pubkey(), taker: r.pubkey() });
      } else if (matches(buf, DISC.OfferCreated)) {
        const r = new Reader(buf);
        out.push({ type: 'OfferCreated', offer: r.pubkey(), bidder: r.pubkey(), collection: r.pubkey(), asset: r.pubkey(), amount: r.u64(), currency: r.u8() });
      } else if (matches(buf, DISC.OfferAccepted)) {
        const r = new Reader(buf);
        out.push({ type: 'OfferAccepted', offer: r.pubkey(), bidder: r.pubkey(), seller: r.pubkey(), asset: r.pubkey(), amount: r.u64(), currency: r.u8() });
      }
    } catch {
      continue;
    }
  }
  return out;
}

// ---- tx helpers -----------------------------------------------------------

function extractLogs(tx: any): string[] {
  return tx?.meta?.logMessages || tx?.transaction?.meta?.logMessages || tx?.logs || [];
}
function sigOf(tx: any): string {
  return tx?.signature || tx?.transaction?.signatures?.[0] || tx?.transaction?.transaction?.signatures?.[0] || '';
}

/** Constant-time secret comparison (SHA-256 both sides → fixed length, no throw). */
function safeEqual(a: string, b: string): boolean {
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  return timingSafeEqual(ah, bh);
}

// ---- handler --------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  // No store configured → indexing is off; accept-and-ignore so setup is easy.
  if (!url || !token) return res.status(200).json({ ok: true, configured: false });

  // Fail closed: a shared secret is mandatory so nobody can POST forged events.
  const secret = process.env.HELIUS_WEBHOOK_SECRET;
  const authHeader = req.headers['authorization'];
  const provided = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!secret || !provided || !safeEqual(provided, secret)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  let redis: any;
  try {
    const { Redis } = await import('@upstash/redis');
    redis = new Redis({ url, token });
  } catch (err) {
    console.error('redis init failed', err);
    return res.status(200).json({ ok: true, configured: false });
  }

  const pushActivity = async (item: Record<string, unknown>) => {
    await redis.lpush(KEYS.activity, item);
    await redis.ltrim(KEYS.activity, 0, ACTIVITY_CAP - 1);
  };

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
          await pushActivity({ id: eventId, kind: 'list', asset: e.asset, price: toUi(e.price, e.currency), currency: cur(e.currency), from: e.seller, time: now, sig });
        } else if (e.type === 'Sold') {
          await redis.hdel(KEYS.listings, e.asset);
          await pushActivity({ id: eventId, kind: 'sale', asset: e.asset, price: toUi(e.price, e.currency), currency: cur(e.currency), from: e.seller, to: e.buyer, time: now, sig });
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
          await pushActivity({ id: eventId, kind: 'sale', asset: e.asset, price: toUi(e.amount, e.currency), currency: cur(e.currency), from: e.seller, to: e.bidder, time: now, sig });
        } else if (e.type === 'SwapCreated') {
          await pushActivity({ id: eventId, kind: 'swap', from: e.maker, time: now, sig });
        } else if (e.type === 'SwapAccepted') {
          await pushActivity({ id: eventId, kind: 'swap', from: e.maker, to: e.taker, time: now, sig });
        }
        processed++;
      }
    } catch (err) {
      console.error('Failed to process tx', err);
    }
  }

  return res.status(200).json({ ok: true, processed });
}
