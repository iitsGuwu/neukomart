import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

// Only embed art from known ecosystem / IPFS gateways (prevents SSRF via the
// server-side image fetch).
const ALLOWED_IMAGE_HOSTS = [
  'pinit.io',
  'mypinata.cloud',
  'pinata.cloud',
  'ipfs.io',
  'nftstorage.link',
  'arweave.net',
  'dweb.link',
  'cloudflare-ipfs.com',
];
function allowedImage(url: string | null): url is string {
  if (!url) return false;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return new URL(url).protocol === 'https:' && ALLOWED_IMAGE_HOSTS.some((d) => h === d || h.endsWith('.' + d));
  } catch {
    return false;
  }
}

/**
 * Dynamic Open Graph image for shareable listing/asset links.
 * Usage: /api/og?name=Harmies%20%23136&collection=Harmies&price=1.2&currency=SOL&image=<url>
 */
export default function handler(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = (searchParams.get('name') || 'NEUKO Market').slice(0, 80);
  const collection = (searchParams.get('collection') || 'G*BOY Ecosystem').slice(0, 40);
  // Parse price as a proper float — reject non-numeric or out-of-range inputs.
  const rawPrice = searchParams.get('price');
  const priceNum = rawPrice != null ? parseFloat(rawPrice) : NaN;
  const price = Number.isFinite(priceNum) && priceNum >= 0 && priceNum < 1e9
    ? priceNum.toFixed(priceNum < 10 ? 3 : 0)
    : null;
  const currency = (searchParams.get('currency') || 'SOL').replace(/[^A-Z$]/g, '').slice(0, 8);
  const image = searchParams.get('image');
  const showImage = allowedImage(image);

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #05070d 0%, #0b0f1c 60%, #0f1424 100%)',
          color: '#e2e8f0',
          fontFamily: 'sans-serif',
          padding: '64px',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: 30, fontWeight: 700 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: '#0f380f',
              border: '2px solid #22e3ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#22e3ff',
            }}
          >
            G*
          </div>
          NEUKO · MARKET
        </div>

        <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: '48px', marginTop: 40 }}>
          {showImage ? (
            <img
              src={image!}
              width={360}
              height={360}
              style={{ borderRadius: 28, objectFit: 'cover', border: '1px solid rgba(255,255,255,0.1)' }}
            />
          ) : (
            <div
              style={{
                width: 360,
                height: 360,
                borderRadius: 28,
                background: 'radial-gradient(circle at 40% 30%, rgba(34,227,255,0.35), transparent), #0b0f1c',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 26, color: '#a98bff', fontWeight: 600 }}>{collection}</div>
            <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.05 }}>{name}</div>
            {price && (
              <div style={{ fontSize: 44, fontWeight: 700, color: '#9bff5a', marginTop: 8 }}>
                {price} {currency}
              </div>
            )}
            <div style={{ fontSize: 26, color: '#94a3b8', marginTop: 8 }}>Feeless · ecosystem-locked · on Solana</div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
