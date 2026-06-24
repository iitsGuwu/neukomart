import fs from 'node:fs';
import path from 'node:path';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { publicKey as umiPk } from '@metaplex-foundation/umi';
import { fetchAsset } from '@metaplex-foundation/mpl-core';

const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'devnet-assets.json'), 'utf8'));
const umi = createUmi('https://api.devnet.solana.com', 'confirmed');

(async () => {
  for (const label of ['H_A_sol', 'H_A_gboy', 'H_A_cancel', 'H_A_offer']) {
    const a = await fetchAsset(umi, umiPk(state.assets[label]));
    console.log(`\n${label} (${state.assets[label]})`);
    console.log('  owner:', a.owner);
    const ser = (x: any) => x ? JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) : 'none';
    console.log('  freezeDelegate:', ser(a.freezeDelegate));
    console.log('  transferDelegate:', ser(a.transferDelegate));
  }
})().catch((e) => { console.error(e); process.exit(1); });
