import type { CollectionKey } from './constants';
import type { NeukoAsset } from './types';

/**
 * Trait configuration per collection, derived from the real on-chain metadata.
 *   Harmies → Background (color), Material, Modification
 *   Badges  → Rank, Emblem
 */
export interface TraitConfig {
  key: string; // trait_type as it appears in metadata
  label: string;
  kind: 'color' | 'list';
}

export const TRAIT_CONFIG: Record<CollectionKey, TraitConfig[]> = {
  harmies: [
    { key: 'Background', label: 'Background color', kind: 'color' },
    { key: 'Material', label: 'Material', kind: 'list' },
    { key: 'Modification', label: 'Modification', kind: 'list' },
  ],
  badges: [
    { key: 'Emblem', label: 'Emblem', kind: 'list' },
    { key: 'Rank', label: 'Rank', kind: 'list' },
  ],
};

/** Background color name -> swatch hex. */
export const BACKGROUND_SWATCH: Record<string, string> = {
  Cream: '#f4e9c8',
  Orange: '#ff9e2c',
  Pink: '#ff9eb5',
  Purple: '#a98bff',
  Red: '#ff4d6d',
  Yellow: '#ffd56b',
  Blue: '#7af0ff',
  Green: '#9bff5a',
  Cyan: '#ff2222',
  Black: '#1f2942',
  White: '#e2e8f0',
};

export function swatchFor(value: string): string {
  return BACKGROUND_SWATCH[value] ?? '#2b3658';
}

export function traitValue(asset: NeukoAsset, key: string): string | undefined {
  return asset.attributes.find((a) => a.trait_type === key)?.value;
}

/** Aggregate the distinct values present for each trait in a set of assets. */
export function collectTraitValues(
  assets: NeukoAsset[],
  collection: CollectionKey,
): Record<string, { value: string; count: number }[]> {
  const out: Record<string, Map<string, number>> = {};
  for (const cfg of TRAIT_CONFIG[collection]) out[cfg.key] = new Map();
  for (const a of assets) {
    if (a.collection !== collection) continue;
    for (const cfg of TRAIT_CONFIG[collection]) {
      const v = traitValue(a, cfg.key);
      if (v == null) continue;
      out[cfg.key].set(v, (out[cfg.key].get(v) ?? 0) + 1);
    }
  }
  const result: Record<string, { value: string; count: number }[]> = {};
  for (const cfg of TRAIT_CONFIG[collection]) {
    result[cfg.key] = [...out[cfg.key].entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => (cfg.kind === 'list' ? b.count - a.count : a.value.localeCompare(b.value)));
  }
  return result;
}
