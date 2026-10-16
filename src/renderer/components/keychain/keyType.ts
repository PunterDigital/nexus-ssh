import type { SSHKey } from '../../../shared/types';

/** A key's type badge: its label ("RSA 4096") and semantic colour classes. */
export function keyTypeBadge(key: Pick<SSHKey, 'key_type' | 'bits'>): { label: string; className: string } {
  const bits = key.bits ? ` ${key.bits}` : '';
  switch (key.key_type) {
    case 'ed25519':
      return { label: 'Ed25519', className: 'bg-success-soft text-success' };
    case 'rsa':
      return { label: `RSA${bits}`, className: 'bg-accent-soft text-accent' };
    case 'ecdsa':
      return { label: `ECDSA${bits}`, className: 'bg-warning-soft text-warning' };
    default:
      return { label: String(key.key_type), className: 'bg-surface text-fg-muted' };
  }
}
