import { DOWNLOADS_PAGE_URL, REPOSITORY_URL } from '../../shared/constants';

/** Links the renderer may open in the default browser. Anything else is refused. */
const ALLOWED = [REPOSITORY_URL, DOWNLOADS_PAGE_URL].map((u) => new URL(u));

/**
 * True for an https URL on an allow-listed origin whose path is the listed path or below it
 * (`/PunterDigital/nexus-ssh/releases` is fine, `/PunterDigital/nexus-ssh-evil` is not).
 * No credentials in the URL, and only the default port.
 */
export function isAllowedExternalUrl(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  return ALLOWED.some((allowed) => {
    if (url.hostname !== allowed.hostname) return false;
    const base = allowed.pathname.replace(/\/$/, '');
    return url.pathname === base || url.pathname.startsWith(`${base}/`);
  });
}
