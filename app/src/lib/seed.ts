import { harmieArt, badgeArt } from './art';
import { seededRandom } from './format';
import type { NeukoAsset } from './types';

/**
 * Offline fallback dataset. Used ONLY when a DAS-enabled RPC is unavailable, so
 * the marketplace still renders something on-brand. Traits mirror the real
 * on-chain schema (Harmies: Background/Material/Modification, Badges:
 * Emblem/Rank) so the trait filters keep working without live data.
 *
 * With a DAS RPC configured (VITE_RPC_URL), real on-chain assets are used
 * everywhere and this set is never shown.
 */

const HARMIE_BACKGROUNDS = ['Cream', 'Orange', 'Pink', 'Purple', 'Red', 'Yellow'];
const HARMIE_MODS = [
  'Helicopter Propeller Hat Bolted On',
  'Burned & Re-stitched',
  'Buried Then Unearthed',
  'Antenna Implant',
  'Patchwork Heart',
  'Cat Eyes',
];
const HARMIE_MATERIAL = ['Plush', 'Felt', 'Foil', 'Glass', 'Yarn', 'Stuffing'];

const BADGE_EMBLEMS = ['Moth', 'Rabbit', 'Snake'];
const BADGE_RANKS = ['1', '2', '3'];

// One genuinely on-chain asset (Harmies #136) with its real IPFS art + traits.
const REAL_HARMIE_136: NeukoAsset = {
  id: '83GZdK62kat2dysQ1dbubTyzULdhAE3urbGJ2od5rkki',
  name: 'Harmies #136',
  collection: 'harmies',
  image:
    'https://gray-patient-duck-402.mypinata.cloud/ipfs/bafybeify6cu2boe5vspdgggcnsybukqhgzxbydzukcxlx6fvpgyef3giky/harmie_136.png',
  number: 136,
  attributes: [
    { trait_type: 'Background', value: 'Purple' },
    { trait_type: 'Modification', value: 'Helicopter Propeller Hat Bolted On' },
    { trait_type: 'Material', value: 'Plush' },
  ],
  generative: false,
};

function pick<T>(rnd: () => number, arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}

function fakeId(seed: string): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const rnd = seededRandom('id:' + seed);
  let s = '';
  for (let i = 0; i < 44; i++) s += chars[Math.floor(rnd() * chars.length)];
  return s;
}

function makeHarmie(n: number): NeukoAsset {
  if (n === 136) return REAL_HARMIE_136;
  const seed = 'harmie-' + n;
  const rnd = seededRandom(seed);
  return {
    id: fakeId(seed),
    name: `Harmies #${n}`,
    collection: 'harmies',
    image: harmieArt(seed),
    number: n,
    attributes: [
      { trait_type: 'Background', value: pick(rnd, HARMIE_BACKGROUNDS) },
      { trait_type: 'Modification', value: pick(rnd, HARMIE_MODS) },
      { trait_type: 'Material', value: pick(rnd, HARMIE_MATERIAL) },
    ],
    generative: true,
  };
}

function makeBadge(n: number): NeukoAsset {
  const seed = 'badge-' + n;
  const rnd = seededRandom(seed);
  const emblem = pick(rnd, BADGE_EMBLEMS);
  return {
    id: fakeId(seed),
    name: `${emblem} Badge #${n}`,
    collection: 'badges',
    image: badgeArt(seed),
    number: n,
    attributes: [
      { trait_type: 'Emblem', value: emblem },
      { trait_type: 'Rank', value: pick(rnd, BADGE_RANKS) },
    ],
    generative: true,
  };
}

const HARMIE_NUMBERS = [136, 4, 11, 27, 42, 58, 73, 88, 104, 119, 152, 167, 188, 203, 221, 240, 266, 289, 311, 333, 360, 388, 412, 451, 480, 499];
const BADGE_NUMBERS = [1, 7, 13, 22, 34, 47, 59, 66, 78, 91, 103, 118, 130, 144, 159, 173, 188, 202, 219, 240, 277, 305, 360, 401, 460, 512];

export const ALL_ASSETS: NeukoAsset[] = [
  ...HARMIE_NUMBERS.map(makeHarmie),
  ...BADGE_NUMBERS.map(makeBadge),
];
