import { useEffect } from 'react';

const BASE_TITLE = 'NEUKO Market · G*BOY Ecosystem';

function setMeta(selector: string, attr: string, value: string) {
  let el = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    const [k, v] = selector.replace('meta[', '').replace(']', '').split('=');
    el.setAttribute(k, v.replace(/["']/g, ''));
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

/** Update the document title + OG/Twitter tags for the current view. */
export function useHead(opts: { title?: string; description?: string; image?: string }) {
  useEffect(() => {
    const title = opts.title ? `${opts.title} · NEUKO Market` : BASE_TITLE;
    document.title = title;
    setMeta('meta[property="og:title"]', 'content', title);
    setMeta('meta[name="twitter:title"]', 'content', title);
    if (opts.description) {
      setMeta('meta[name="description"]', 'content', opts.description);
      setMeta('meta[property="og:description"]', 'content', opts.description);
    }
    if (opts.image) {
      setMeta('meta[property="og:image"]', 'content', opts.image);
      setMeta('meta[name="twitter:image"]', 'content', opts.image);
    }
    return () => {
      document.title = BASE_TITLE;
    };
  }, [opts.title, opts.description, opts.image]);
}

/** Build the dynamic OG image URL for an asset/listing. */
export function ogImageUrl(params: { name: string; collection: string; price?: number; currency?: string; image?: string }): string {
  const q = new URLSearchParams();
  q.set('name', params.name);
  q.set('collection', params.collection);
  if (params.price != null) q.set('price', String(params.price));
  if (params.currency) q.set('currency', params.currency);
  if (params.image && params.image.startsWith('http')) q.set('image', params.image);
  return `/api/og?${q.toString()}`;
}
