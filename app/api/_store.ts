import { Redis } from '@upstash/redis';

/**
 * Storage for the on-chain indexer. Uses Upstash Redis (the Vercel KV / Upstash
 * integration sets these env vars automatically). Returns null when not
 * configured, so the API degrades gracefully and the frontend falls back to its
 * local data.
 */
export function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export const KEYS = {
  listings: 'neuko:listings', // hash: assetId -> Listing
  offers: 'neuko:offers', // hash: offerId -> Offer
  activity: 'neuko:activity', // list (LPUSH, capped)
};

export const ACTIVITY_CAP = 500;
