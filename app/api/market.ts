import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRedis, KEYS } from './_store';

/** Combined read endpoint for the indexer: listings + offers + recent activity.
 *
 * `_store` is imported statically (a dynamic `import('./_store')` does NOT
 * resolve in Vercel's bundled ESM function runtime — it threw "Cannot find
 * module" and made this endpoint always report configured:false). The Redis
 * client construction + calls are wrapped in try/catch so a missing or
 * unreachable store degrades to `configured:false` instead of crashing
 * (FUNCTION_INVOCATION_FAILED), letting the client fall back to live Magic Eden
 * data. */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const redis = getRedis();
    if (!redis) {
      return res.status(200).json({ configured: false, listings: [], offers: [], activity: [] });
    }
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
    return res.status(200).json({ configured: false, listings: [], offers: [], activity: [] });
  }
}
