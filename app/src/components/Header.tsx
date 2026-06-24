import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import clsx from 'clsx';
import { Menu, X, ShoppingCart, Sun, Moon } from 'lucide-react';
import { NeukoLogo, CurrencyIcon } from './ui';
import { CartDrawer } from './CartDrawer';
import { useBalances } from '../hooks/useWalletData';
import { NETWORK_LABEL } from '../lib/constants';
import { formatAmount } from '../lib/format';
import { useCart, cartTotals } from '../lib/cart';
import { useTheme, toggleTheme } from '../lib/theme';

const NAV = [
  { to: '/market', label: 'Market' },
  { to: '/swap', label: 'Swap Studio' },
  { to: '/activity', label: 'Activity' },
  { to: '/portfolio', label: 'Portfolio' },
];

function BalancePill() {
  const { connected } = useWallet();
  const { data } = useBalances();
  if (!connected || !data) return null;
  return (
    <div className="hidden xl:flex items-center gap-3 rounded-xl bg-ink-850/70 border px-3 py-1.5 text-sm shrink-0" style={{ borderColor: 'var(--border)' }}>
      <span className="flex items-center gap-1.5">
        <CurrencyIcon currency="sol" size={14} />
        <span className="tabular-nums font-medium">{formatAmount(data.sol, 'sol')}</span>
      </span>
      <span className="h-3 w-px bg-[var(--active)]" />
      <span className="flex items-center gap-1.5">
        <CurrencyIcon currency="gboy" size={14} />
        <span className="tabular-nums font-medium">{formatAmount(data.gboy, 'gboy')}</span>
      </span>
    </div>
  );
}

function IconBtn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label} className="btn-ghost !p-2 !rounded-lg relative">
      {children}
    </button>
  );
}

export function Header() {
  const [open, setOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const loc = useLocation();
  const theme = useTheme();
  const cart = useCart();
  const cartCount = cartTotals().count;

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-ink-950/70 backdrop-blur-xl" style={{ borderColor: 'var(--border)' }}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between gap-4">
            <div className="flex items-center gap-7">
              <NeukoLogo />
              <nav className="hidden lg:flex items-center gap-1">
                {NAV.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    className={({ isActive }) =>
                      clsx(
                        'px-3.5 py-2 rounded-lg text-sm font-medium transition-colors',
                        isActive ? 'text-slate-50 bg-[var(--active)]' : 'text-slate-400 hover:text-slate-50 hover:bg-[var(--hover)]',
                      )
                    }
                  >
                    {n.label}
                  </NavLink>
                ))}
              </nav>
            </div>

            <div className="flex items-center gap-2">
              <BalancePill />

              {/* theme */}
              <IconBtn onClick={toggleTheme} label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
                {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
              </IconBtn>

              {/* cart */}
              <IconBtn onClick={() => setCartOpen(true)} label="Sweep cart">
                <ShoppingCart size={17} />
                {cartCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-neon px-1 text-[10px] font-bold text-[var(--on-accent)]">
                    {cartCount}
                  </span>
                )}
              </IconBtn>

              <WalletMultiButton />
              <button className="lg:hidden btn-ghost !p-2 !rounded-lg" onClick={() => setOpen((o) => !o)}>
                {open ? <X size={18} /> : <Menu size={18} />}
              </button>
            </div>
          </div>
        </div>

        {open && (
          <nav className="lg:hidden border-t bg-ink-900/95 px-4 py-3 space-y-1" style={{ borderColor: 'var(--border)' }}>
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                onClick={() => setOpen(false)}
                className={clsx('block px-3 py-2.5 rounded-lg text-sm font-medium', loc.pathname === n.to ? 'text-slate-50 bg-[var(--active)]' : 'text-slate-300')}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
      {/* keep cart subscription active for the badge */}
      <span className="hidden">{cart.length}</span>
    </>
  );
}
