/**
 * Path containment and the renderer's permissions (#5612). No Electron imports: unit-tested
 * (tests/unit/security-hardening.test.ts).
 */
import * as path from 'path';

/**
 * True when `filePath` is `root` itself or inside it. A plain `startsWith(root)` also let
 * a sibling folder through (`…/renderer-old/x` starts with `…/renderer`).
 */
export function isInsideRoot(root: string, filePath: string): boolean {
  const r = path.resolve(root);
  const f = path.resolve(filePath);
  return f === r || f.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/**
 * The only permissions the renderer may have: the terminal copies a selection and pastes on
 * right-click (navigator.clipboard). WebAuthn (hardware-key unlock) needs no permission
 * request. Everything else (camera, microphone, geolocation, notifications, HID/USB/serial,
 * MIDI, …) is refused.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write']);

export function isPermissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}
