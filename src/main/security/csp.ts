// ============================================================
// Nexus SSH Client — Content Security Policy
// ============================================================

import { app } from 'electron';

const isDev = !app.isPackaged;

/**
 * Returns a Content-Security-Policy header string for the renderer.
 *
 * In development, Vite injects inline scripts and uses a WebSocket for HMR,
 * so the policy is relaxed. In production, a strict policy is enforced.
 */
export function getCSPHeader(): string {
  if (isDev) {
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self' ws://localhost:* http://localhost:*",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; ');
  }

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');
}
