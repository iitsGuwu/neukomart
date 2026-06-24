import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import '@solana/wallet-adapter-react-ui/styles.css';
import './index.css';
import { initTheme } from './lib/theme';
import App from './App';
import { AppProviders } from './providers/AppProviders';

initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders>
        <App />
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#0b0f1c',
              color: '#e2e8f0',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '14px',
              fontSize: '14px',
            },
          }}
        />
      </AppProviders>
    </BrowserRouter>
  </React.StrictMode>,
);
