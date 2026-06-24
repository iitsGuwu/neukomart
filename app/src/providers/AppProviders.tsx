import { useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import type { Adapter } from '@solana/wallet-adapter-base';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RPC_URL } from '../lib/constants';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

export function AppProviders({ children }: { children: ReactNode }) {
  // Phantom, Solflare and other modern wallets register themselves via the
  // Wallet Standard, so the WalletProvider auto-detects them. Passing the
  // legacy PhantomWalletAdapter/SolflareWalletAdapter in addition creates a
  // duplicate registration over Phantom's deprecated injection path, which
  // breaks connect — so we pass none and let Standard detection handle it.
  const wallets = useMemo<Adapter[]>(() => [], []);

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
