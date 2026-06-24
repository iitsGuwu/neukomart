/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_NETWORK?: string;
  readonly VITE_DEMO?: string;
  readonly VITE_LOOKUP_TABLE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
