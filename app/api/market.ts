import type { VercelRequest, VercelResponse } from '@vercel/node';

/** Combined read endpoint for the indexer: listings + offers + recent activity.
 *
 * The Redis setup is INLINED here (no `./_store` import): an underscore-prefixed
 * shared module in `api/` does not resolve in Vercel's bundled function runtime
 * — importing it (static OR dynamic) crashes with "Cannot find module
 * /var/task/app/api/_store" / FUNCTION_INVOCATION_FAILED, which silently
 * disabled this endpoint (always configured:false) regardless of Upstash.
 * Importing `@upstash/redis` directly works. Keys mirror `_store.ts`. */
const KEYS = {
  listings: 'neuko:listings',
  offers: 'neuko:offers',
  activity: 'neuko:activity',
} as const;

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const empty = { configured: false, listings: [], offers: [], activity: [] };
  try {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return res.status(200).json(empty);

    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({ url, token });
    const [listings, offers, activity] = await Promise.all([
      redis.hvals(KEYS.listings),
      redis.hvals(KEYS.offers),
      redis.lrange(KEYS.activity, 0, 200),
    ]);
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    return res.status(200).json({
      configured: true,
      listings: listings || [],
      offers: offers || [],
      activity: activity || [],
    });
  } catch (err) {
    console.error('market read failed', err);
    return res.status(200).json(empty);
  }
}
