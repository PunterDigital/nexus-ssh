import { describe, expect, it } from 'vitest';
import { utils } from 'ssh2';
import { generateEd25519KeyPair } from '../fixtures/ssh-server';

// #5417: ssh2's ed25519 keygen writes an unparseable key when the public key
// starts with 0x00 (1 in 256). The test server's host key comes from
// generateEd25519KeyPair(), which must never hand out such a key.
describe('test SSH server host key', () => {
  it('every generated key pair parses, with a 32-byte public key', () => {
    // 3000 draws: the chance that none of them hits a bad raw key is ~0.001%,
    // so this exercises the retry path on practically every run.
    for (let i = 0; i < 3000; i++) {
      const pair = generateEd25519KeyPair();
      const priv = utils.parseKey(pair.private);
      const pub = utils.parseKey(pair.public);
      expect(priv).not.toBeInstanceOf(Error);
      expect(pub).not.toBeInstanceOf(Error);
      const parsed = Array.isArray(priv) ? priv[0] : priv;
      if (parsed instanceof Error) throw parsed;
      expect(parsed.type).toBe('ssh-ed25519');
      const blob = parsed.getPublicSSH();
      expect(blob.length).toBe(51);
      expect(blob.readUInt32BE(15)).toBe(32);
      expect(blob.equals(Buffer.from(pair.public.split(' ')[1], 'base64'))).toBe(true);
    }
  });
});
