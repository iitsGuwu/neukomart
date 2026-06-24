import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRedis, KEYS } from './_store';

/** Combined read endpoint for the indexer: listings + offers + recent activity. */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
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
}
