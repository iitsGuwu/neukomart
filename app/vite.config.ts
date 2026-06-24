import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // Solana web3.js expects Buffer / process in the browser
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.jpg'],
      manifest: {
        name: 'NEUKO Market',
        short_name: 'NEUKO',
        description: 'The native, feeless marketplace for the G*BOY ecosystem.',
        theme_color: '#05070d',
        background_color: '#05070d',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/logo.jpg', sizes: '512x512', type: 'image/jpeg', purpose: 'any' },
          { src: '/logo.jpg', sizes: '512x512', type: 'image/jpeg', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallbackDenylist: [/^\/api/],
        maximumFileSizeToCacheInBytes: 5_000_000,
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Proxy the Magic Eden API in local dev (it has no CORS headers). In
      // production the same path is served by the Vercel function in
      // app/api/magiceden/[...path].ts.
      '/api/magiceden': {
        target: 'https://api-mainnet.magiceden.dev',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/magiceden/, ''),
      },
      // Local dev stubs for the buy instruction proxies.
      // These forward to the real upstream so you can test with real API keys
      // set as local env vars (ME_API_KEY / TENSOR_API_KEY in .env.local).
      // In production the Vercel functions handle these routes instead.
      '/api/me-buy': {
        target: 'https://api-mainnet.magiceden.dev',
        changeOrigin: true,
        secure: true,
        rewrite: (_path) => '/v2/instructions/buy_now',
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const key = process.env.ME_API_KEY;
            if (key) proxyReq.setHeader('authorization', `Bearer ${key}`);
          });
        },
      },
      '/api/tensor-buy': {
        target: 'https://api.mainnet.tensordev.io',
        changeOrigin: true,
        secure: true,
        rewrite: (_path) => '/graphql',
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const key = process.env.TENSOR_API_KEY;
            if (key) proxyReq.setHeader('x-tensor-api-key', key);
          });
        },
      },
    },
  },
  define: {
    'process.env.ANCHOR_BROWSER': true,
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          solana: ['@solana/web3.js', '@solana/spl-token'],
          wallet: [
            '@solana/wallet-adapter-base',
            '@solana/wallet-adapter-react',
            '@solana/wallet-adapter-react-ui',
            '@solana/wallet-adapter-phantom',
            '@solana/wallet-adapter-solflare',
          ],
          vendor: ['react', 'react-dom', 'react-router-dom', 'framer-motion', '@tanstack/react-query'],
        },
      },
    },
  },
});
