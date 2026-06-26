import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * TEMPORARY diagnostic for the Upstash/Redis indexer connection.
 *
 * Reports which Upstash-related env vars the function can see (presence only —
 * URL *hosts* and token *lengths*, never secret values) plus a live set/get
 * round-trip so we can see whether the credentials actually work. Guarded by a
 * shared probe value so it isn't openly discoverable. DELETE this file once the
 * indexer is confirmed working.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.query?.probe !== 'neuko-upstash-2026') {
    return res.status(404).json({ error: 'not found' });
  }

  const candidates = [
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
    'KV_REST_API_READ_ONLY_TOKEN',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'KV_URL',
    'REDIS_URL',
  ];

  const vars: Record<string, string> = {};
  for (const k of candidates) {
    const v = process.env[k];
    if (!v) {
      vars[k] = 'MISSING';
    } else if (k.includes('URL')) {
      try {
        vars[k] = `host=${new URL(v).host} (len ${v.length})`;
      } catch {
        vars[k] = `unparseable-url (len ${v.length})`;
      }
    } else {
      vars[k] = `present (len ${v.length})`;
    }
  }

  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  let connection: Record<string, unknown> = { attempted: false };
  if (url && token) {
    connection = { attempted: true, pingOk: false, error: null };
    try {
      const { Redis } = await import('@upstash/redis');
      const redis = new Redis({ url, token });
      const probeKey = 'neuko:debug:' + Date.now();
      await redis.set(probeKey, 'ok', { ex: 30 });
      const got = await redis.get(probeKey);
      connection.pingOk = got === 'ok';
    } catch (e) {
      connection.error = String((e as Error)?.message || e).slice(0, 300);
    }
  }

  return res.status(200).json({
    note: 'TEMPORARY — delete app/api/market-debug.ts after debugging',
    resolved: { hasUrl: !!url, hasToken: !!token },
    vars,
    connection,
  });
}
