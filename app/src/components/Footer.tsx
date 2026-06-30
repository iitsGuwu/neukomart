import { NeukoLogo, EcoBadge } from './ui';
import { BADGES_COLLECTION, HARMIES_COLLECTION, GBOY_MINT } from '../lib/constants';
import { shortAddress } from '../lib/format';

export function Footer() {
  const rows: [string, string][] = [
    ['Badges', BADGES_COLLECTION.toBase58()],
    ['Harmies', HARMIES_COLLECTION.toBase58()],
    ['$GBOY', GBOY_MINT.toBase58()],
  ];
  return (
    <footer className="relative z-10 mt-20 border-t border-[color:var(--border)] bg-ink-950/60">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <NeukoLogo />
            <p className="mt-4 text-sm text-slate-400 max-w-xs">
              The native, feeless marketplace for the G*BOY ecosystem. Buy, sell and barter Badges
              &amp; Harmies with SOL or $GBOY.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <EcoBadge tone="gboy">0% fees</EcoBadge>
              <EcoBadge tone="neon">Ecosystem-locked</EcoBadge>
            </div>
          </div>
          <div>
            <div className="label mb-3">Ecosystem registry</div>
            <ul className="space-y-2 text-sm">
              {rows.map(([k, v]) => (
                <li key={k} className="flex items-center justify-between gap-4">
                  <span className="text-slate-400">{k}</span>
                  <code className="text-xs text-slate-300 font-mono">{shortAddress(v, 6)}</code>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="label mb-3">How it works</div>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>Non-custodial: your keys, your assets.</li>
              <li>Zero protocol fees. You pay only Solana gas.</li>
              <li>Restricted to Badges, Harmies &amp; $GBOY by design.</li>
            </ul>
          </div>
        </div>
        <div className="mt-10 pt-6 border-t border-[color:var(--border)] text-xs text-slate-500 flex flex-col gap-3">
          <p className="max-w-4xl leading-relaxed">
            © {new Date().getFullYear()}{' '}
            <a href="https://harmie.xyz" target="_blank" rel="noreferrer" className="text-slate-300 hover:text-neon">
              HARMIE.XYZ
            </a>
            . Built by the community for the community. Not affiliated with{' '}
            <FootLink href="https://x.com/neukoai">Neuko</FootLink> or the{' '}
            <FootLink href="https://www.harmonyrx.net/">Harmony</FootLink> project. Enormous thank
            you to <FootLink href="https://x.com/TheDouble6">Chasin</FootLink>,{' '}
            <FootLink href="https://x.com/LiquorGrainNFT">LiquorGrain</FootLink>,{' '}
            <FootLink href="https://x.com/ReeceSolana">Reece</FootLink> and{' '}
            <FootLink href="https://x.com/iitsGuru">iitsGuru</FootLink> for making this marketplace a
            reality.
          </p>
          <p>
            Fully open source.{' '}
            <FootLink href="https://github.com/iitsGuwu/neukomart">
              View the code on GitHub
            </FootLink>
            . Audit it, fork it, contribute.
          </p>
          <span>Built on Solana · Metaplex Core</span>
        </div>
      </div>
    </footer>
  );
}

function FootLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-neon hover:underline font-medium">
      {children}
    </a>
  );
}
