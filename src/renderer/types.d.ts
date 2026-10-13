import type { NexusAPI } from '../main/preload';

declare global {
  interface Window {
    nexus: NexusAPI;
  }
}
