import type { VercelRequest, VercelResponse } from '@vercel/node';

/** Combined read endpoint for the indexer: listings + offers + recent activity.
 *
 * Everything (including the store import + client construction) runs inside one
 * try/catch and dynamic import, so a missing/misconfigured/unreachable Redis can
 * never crash the function (FUNCTION_INVOCATION_FAILED). On any failure it
 * degrades to `configured:false` so the client falls back to live Magic Eden
 * data cleanly. */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const { getRedis, KEYS } = await import('./_store');
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
