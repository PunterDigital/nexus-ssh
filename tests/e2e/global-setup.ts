import { createRequire } from 'node:module';

// Electron 44 downloads its binary lazily on first use. With several Playwright workers that
// download races: one worker launches while another is still extracting, and dyld finds a
// truncated Electron Framework. Resolving the path here downloads it once, before any worker starts.
export default function globalSetup(): void {
  if (process.env.NEXUS_E2E_EXECUTABLE) return; // packaged app: no dev Electron needed
  const electronPath = createRequire(__filename)('electron') as string;
  console.log(`Electron binary: ${electronPath}`);
}
