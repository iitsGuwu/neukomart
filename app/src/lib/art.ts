import { seededRandom } from './format';

/**
 * Procedural, on-brand art so every card renders instantly and offline.
 * - Harmies: stitched-up plush characters ("500 reasons to smile").
 * - Badges:  retro G*BOY pixel medals.
 *
 * When a real DAS endpoint is configured, fetched IPFS art takes precedence
 * and these are only used as a graceful fallback.
 */

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const HARMIE_BG = ['#7b5cff', '#ff2222', '#ff7a59', '#9bff5a', '#a98bff', '#ff4d6d'];
const HARMIE_BODY = ['#ffd56b', '#ff9eb5', '#9be7ff', '#c5ff8a', '#ffb38a', '#d9b3ff'];

export function harmieArt(seed: string): string {
  const rnd = seededRandom('harmie:' + seed);
  const bg = HARMIE_BG[Math.floor(rnd() * HARMIE_BG.length)];
  const body = HARMIE_BODY[Math.floor(rnd() * HARMIE_BODY.length)];
  const eyeY = 150 + rnd() * 14;
  const smile = 30 + rnd() * 30;
  const patchX = 120 + rnd() * 160;
  const patchY = 200 + rnd() * 90;
  const antenna = rnd() > 0.5;
  const rot = (rnd() - 0.5) * 10;
  const cheek = '#ff7a9c';
  return svgToDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <defs>
    <radialGradient id="g" cx="50%" cy="35%" r="80%">
      <stop offset="0%" stop-color="${bg}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#080b14"/>
    </radialGradient>
    <filter id="s"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000" flood-opacity="0.45"/></filter>
  </defs>
  <rect width="400" height="400" fill="url(#g)"/>
  <g transform="rotate(${rot} 200 220)" filter="url(#s)">
    ${antenna ? `<line x1="200" y1="110" x2="200" y2="70" stroke="${body}" stroke-width="6"/><circle cx="200" cy="64" r="10" fill="${cheek}"/>` : ''}
    <rect x="110" y="120" width="180" height="190" rx="60" fill="${body}"/>
    <rect x="150" y="285" width="34" height="55" rx="16" fill="${body}"/>
    <rect x="216" y="285" width="34" height="55" rx="16" fill="${body}"/>
    <circle cx="170" cy="${eyeY}" r="16" fill="#0b0f1c"/>
    <circle cx="230" cy="${eyeY}" r="16" fill="#0b0f1c"/>
    <circle cx="175" cy="${eyeY - 5}" r="5" fill="#fff"/>
    <circle cx="235" cy="${eyeY - 5}" r="5" fill="#fff"/>
    <circle cx="150" cy="${eyeY + 28}" r="11" fill="${cheek}" opacity="0.7"/>
    <circle cx="250" cy="${eyeY + 28}" r="11" fill="${cheek}" opacity="0.7"/>
    <path d="M168 ${eyeY + 30} Q200 ${eyeY + 30 + smile} 232 ${eyeY + 30}" stroke="#0b0f1c" stroke-width="6" fill="none" stroke-linecap="round"/>
    <g stroke="#0b0f1c" stroke-width="3" opacity="0.85">
      <line x1="${patchX}" y1="${patchY}" x2="${patchX + 36}" y2="${patchY}"/>
      <line x1="${patchX + 6}" y1="${patchY - 8}" x2="${patchX + 6}" y2="${patchY + 8}"/>
      <line x1="${patchX + 18}" y1="${patchY - 8}" x2="${patchX + 18}" y2="${patchY + 8}"/>
      <line x1="${patchX + 30}" y1="${patchY - 8}" x2="${patchX + 30}" y2="${patchY + 8}"/>
    </g>
  </g>
</svg>`);
}

const BADGE_METAL = [
  ['#ff2222', '#d90000'],
  ['#9bff5a', '#5fd92e'],
  ['#ffd56b', '#ff9e2c'],
  ['#a98bff', '#7b5cff'],
  ['#ff7a59', '#ff4d6d'],
];
const BADGE_GLYPH = ['★', '✦', '◆', '⬡', '⚡', '✺', '☗', '✚'];

export function badgeArt(seed: string): string {
  const rnd = seededRandom('badge:' + seed);
  const [c1, c2] = BADGE_METAL[Math.floor(rnd() * BADGE_METAL.length)];
  const glyph = BADGE_GLYPH[Math.floor(rnd() * BADGE_GLYPH.length)];
  const points = 6 + Math.floor(rnd() * 4);
  const r1 = 120;
  const r2 = 92;
  const cx = 200;
  const cy = 195;
  let star = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = (Math.PI / points) * i - Math.PI / 2;
    star += `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)} `;
  }
  return svgToDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <defs>
    <radialGradient id="bg" cx="50%" cy="30%" r="90%">
      <stop offset="0%" stop-color="${c1}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#05070d"/>
    </radialGradient>
    <linearGradient id="m" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
    <filter id="gl"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="400" height="400" fill="url(#bg)"/>
  <g opacity="0.18" stroke="${c1}" stroke-width="2">
    ${Array.from({ length: 8 }, (_, i) => `<line x1="0" y1="${i * 50 + 10}" x2="400" y2="${i * 50 + 10}"/>`).join('')}
  </g>
  <polygon points="${star}" fill="url(#m)" filter="url(#gl)" stroke="#05070d" stroke-width="4"/>
  <circle cx="${cx}" cy="${cy}" r="58" fill="#0b0f1c" stroke="${c1}" stroke-width="3"/>
  <text x="${cx}" y="${cy + 22}" font-size="64" text-anchor="middle" fill="${c1}" font-family="monospace">${glyph}</text>
  <rect x="155" y="300" width="90" height="58" rx="8" fill="#0f380f" opacity="0.85"/>
  <text x="200" y="338" font-size="22" text-anchor="middle" fill="#9bff5a" font-family="monospace">G*BOY</text>
</svg>`);
}
