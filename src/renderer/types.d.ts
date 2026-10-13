import type { NexusAPI } from '../main/preload';

declare global {
  /** package.json version, injected by Vite at build time. */
  const __APP_VERSION__: string;

  interface Window {
    nexus: NexusAPI;
  }
}
