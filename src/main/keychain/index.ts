/**
 * SSH keychain manager.
 * Manages SSH key generation, import, export, and storage.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { SSHKey, KeyGenerateOptions, KeyType } from '@shared/types';

const execFileAsync = promisify(execFile);

class KeychainManager {
  /**
   * Generate a new SSH key pair using ssh-keygen.
   */
  async generateKey(options: KeyGenerateOptions, vaultId: string): Promise<SSHKey> {
    const { keyType, bits, passphrase, comment, name } = options;
    const tempDir = await this.createTempDir();

    try {
      const keyPath = path.join(tempDir, 'id_key');

      const args: string[] = [
        '-t', keyType,
        '-f', keyPath,
        '-N', passphrase || '',
        '-C', comment || '',
      ];

      // Add bits flag for RSA and ECDSA (ed25519 doesn't use -b)
      if (keyType === 'rsa') {
        args.push('-b', String(bits || 4096));
      } else if (keyType === 'ecdsa') {
        args.push('-b', String(bits || 256));
      }

      await execFileAsync('ssh-keygen', args);

      const privateKey = await fs.readFile(keyPath, 'utf-8');
      const publicKey = await fs.readFile(`${keyPath}.pub`, 'utf-8');

      const fingerprint = this.calculateFingerprint(publicKey.trim());

      const resolvedBits = this.resolveBits(keyType, bits);
      const now = new Date().toISOString();

      const sshKey: SSHKey = {
        id: uuidv4(),
        vault_id: vaultId,
        name,
        key_type: keyType,
        bits: resolvedBits,
        fingerprint,
        public_key: publicKey.trim(),
        private_key: privateKey,
        passphrase: passphrase || null,
        created_at: now,
        updated_at: now,
      };

      return sshKey;
    } finally {
      await this.secureCleanup(tempDir);
    }
  }

  /**
   * Import a key from raw private key content.
   */
  async importKey(params: {
    name: string;
    privateKeyContent: string;
    vaultId: string;
    passphrase?: string;
  }): Promise<SSHKey> {
    const { name, privateKeyContent, vaultId, passphrase } = params;

    let privateKey = privateKeyContent;
    let publicKey: string;

    // Detect and convert PPK format
    if (this.isPPKFormat(privateKey)) {
      const converted = await this.convertPPK(privateKey, passphrase);
      privateKey = converted.privateKey;
      publicKey = converted.publicKey;
    } else {
      // Extract public key from private key using ssh-keygen
      publicKey = await this.derivePublicKey(privateKey, passphrase);
    }

    const { keyType, bits } = this.detectKeyType(privateKey);
    const fingerprint = this.calculateFingerprint(publicKey.trim());
    const now = new Date().toISOString();

    const sshKey: SSHKey = {
      id: uuidv4(),
      vault_id: vaultId,
      name,
      key_type: keyType,
      bits,
      fingerprint,
      public_key: publicKey.trim(),
      private_key: privateKey,
      passphrase: passphrase || null,
      created_at: now,
      updated_at: now,
    };

    return sshKey;
  }

  /**
   * Import a key from a file path on disk.
   */
  async importKeyFromFile(params: {
    name: string;
    filePath: string;
    vaultId: string;
    passphrase?: string;
  }): Promise<SSHKey> {
    const content = await fs.readFile(params.filePath, 'utf-8');
    return this.importKey({
      name: params.name,
      privateKeyContent: content,
      vaultId: params.vaultId,
      passphrase: params.passphrase,
    });
  }

  /**
   * Calculate SHA256 fingerprint from a public key string.
   *
   * Format: "SHA256:<base64-hash-without-trailing-equals>"
   */
  calculateFingerprint(publicKey: string): string {
    // Public key format: "ssh-type AAAAB3Nza... comment"
    const parts = publicKey.trim().split(/\s+/);
    if (parts.length < 2) {
      throw new Error('Invalid public key format: expected at least two space-separated fields');
    }

    const keyData = Buffer.from(parts[1], 'base64');
    const hash = crypto.createHash('sha256').update(keyData).digest('base64');

    // Remove trailing '=' padding
    const trimmed = hash.replace(/=+$/, '');
    return `SHA256:${trimmed}`;
  }

  /**
   * Detect the key type and bit size from private key content.
   */
  detectKeyType(privateKey: string): { keyType: KeyType; bits: number | null } {
    const content = privateKey.trim();

    // RSA keys
    if (content.includes('BEGIN RSA PRIVATE KEY') || content.includes('BEGIN RSA PRIVATE')) {
      return { keyType: 'rsa', bits: this.estimateRSABits(content) };
    }

    // EC / ECDSA keys
    if (content.includes('BEGIN EC PRIVATE KEY') || content.includes('ecdsa-sha2')) {
      return { keyType: 'ecdsa', bits: this.estimateECDSABits(content) };
    }

    // OpenSSH format — need to inspect the key blob
    if (content.includes('BEGIN OPENSSH PRIVATE KEY')) {
      return this.detectOpenSSHKeyType(content);
    }

    // Ed25519 explicit marker in public portion
    if (content.includes('ssh-ed25519')) {
      return { keyType: 'ed25519', bits: 256 };
    }

    // Default fallback for ambiguous OpenSSH keys
    return { keyType: 'ed25519', bits: 256 };
  }

  /**
   * Parse PuTTY PPK format and convert to OpenSSH format.
   * Writes to a temp file and attempts conversion via ssh-keygen.
   */
  async convertPPK(
    ppkContent: string,
    passphrase?: string,
  ): Promise<{ privateKey: string; publicKey: string }> {
    const tempDir = await this.createTempDir();

    try {
      const ppkPath = path.join(tempDir, 'key.ppk');
      const opensshPath = path.join(tempDir, 'key_openssh');

      await fs.writeFile(ppkPath, ppkContent, { mode: 0o600 });

      // Try puttygen first (available on many systems)
      try {
        const puttygenArgs = [ppkPath, '-O', 'private-openssh', '-o', opensshPath];
        if (passphrase) {
          puttygenArgs.push('-P');
          // puttygen reads passphrase from stdin when -P is used in some versions,
          // but the common approach is to set it via --old-passphrase
          // We try the simpler approach first
        }
        await execFileAsync('puttygen', puttygenArgs);

        const privateKey = await fs.readFile(opensshPath, 'utf-8');
        const publicKey = await this.derivePublicKey(privateKey, passphrase);

        return { privateKey, publicKey };
      } catch {
        // puttygen not available, try ssh-keygen import
      }

      // Fallback: try ssh-keygen -i for RFC4716 conversion
      // This works for some PPK exports
      try {
        const { stdout: privateKey } = await execFileAsync('ssh-keygen', [
          '-i', '-f', ppkPath, '-m', 'PEM',
        ]);

        const publicKey = await this.derivePublicKey(privateKey, passphrase);
        return { privateKey, publicKey };
      } catch {
        // ssh-keygen import also failed
      }

      // Manual PPK parsing as last resort (unencrypted keys only)
      return this.parsePPKManually(ppkContent, passphrase);
    } finally {
      await this.secureCleanup(tempDir);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Derive a public key from a private key using ssh-keygen -y.
   */
  private async derivePublicKey(privateKey: string, passphrase?: string): Promise<string> {
    const tempDir = await this.createTempDir();

    try {
      const keyPath = path.join(tempDir, 'tmpkey');
      await fs.writeFile(keyPath, privateKey, { mode: 0o600 });

      const args = ['-y', '-f', keyPath];
      if (passphrase) {
        args.push('-P', passphrase);
      }

      const { stdout } = await execFileAsync('ssh-keygen', args);
      return stdout.trim();
    } finally {
      await this.secureCleanup(tempDir);
    }
  }

  /**
   * Detect whether content is PuTTY PPK format.
   */
  private isPPKFormat(content: string): boolean {
    return (
      content.startsWith('PuTTY-User-Key-File-2:') ||
      content.startsWith('PuTTY-User-Key-File-3:')
    );
  }

  /**
   * Best-effort manual PPK parser for unencrypted keys.
   * Extracts algorithm and public key blob from the PPK text.
   */
  private async parsePPKManually(
    ppkContent: string,
    passphrase?: string,
  ): Promise<{ privateKey: string; publicKey: string }> {
    const lines = ppkContent.split(/\r?\n/);

    let algorithm = '';
    let encryption = '';
    const publicLines: string[] = [];
    const privateLines: string[] = [];
    let section: 'none' | 'public' | 'private' = 'none';
    let remainingPublic = 0;
    let remainingPrivate = 0;

    for (const line of lines) {
      if (line.startsWith('PuTTY-User-Key-File-2:') || line.startsWith('PuTTY-User-Key-File-3:')) {
        algorithm = line.split(':')[1]?.trim() || '';
        continue;
      }
      if (line.startsWith('Encryption:')) {
        encryption = line.split(':')[1]?.trim() || '';
        continue;
      }
      if (line.startsWith('Public-Lines:')) {
        remainingPublic = parseInt(line.split(':')[1]?.trim() || '0', 10);
        section = 'public';
        continue;
      }
      if (line.startsWith('Private-Lines:')) {
        remainingPrivate = parseInt(line.split(':')[1]?.trim() || '0', 10);
        section = 'private';
        continue;
      }
      if (line.startsWith('Comment:') || line.startsWith('Private-MAC:') || line.startsWith('Private-Hash:')) {
        section = 'none';
        continue;
      }

      if (section === 'public' && remainingPublic > 0) {
        publicLines.push(line);
        remainingPublic--;
        if (remainingPublic === 0) section = 'none';
      } else if (section === 'private' && remainingPrivate > 0) {
        privateLines.push(line);
        remainingPrivate--;
        if (remainingPrivate === 0) section = 'none';
      }
    }

    if (encryption !== 'none' && encryption !== '') {
      throw new Error(
        'Encrypted PPK keys require puttygen for conversion. ' +
        'Please install PuTTY tools or convert the key to OpenSSH format manually.',
      );
    }

    // Build the public key in OpenSSH format
    const publicKeyBlob = publicLines.join('');
    const sshAlgorithm = this.ppkAlgorithmToSSH(algorithm);
    const publicKey = `${sshAlgorithm} ${publicKeyBlob}`;

    // For the private key, we cannot trivially reconstruct an OpenSSH private key
    // from PPK's raw private blob without a full ASN.1 / OpenSSH serializer.
    // Write a combined temp file and attempt ssh-keygen conversion as a last ditch effort.
    throw new Error(
      'Manual PPK private key conversion is not supported. ' +
      'Please install puttygen or convert the key to OpenSSH format using: ' +
      'ssh-keygen -i -f key.ppk',
    );
  }

  /**
   * Map PPK algorithm names to OpenSSH algorithm prefixes.
   */
  private ppkAlgorithmToSSH(algo: string): string {
    switch (algo) {
      case 'ssh-rsa': return 'ssh-rsa';
      case 'ssh-dss': return 'ssh-dss';
      case 'ssh-ed25519': return 'ssh-ed25519';
      case 'ecdsa-sha2-nistp256': return 'ecdsa-sha2-nistp256';
      case 'ecdsa-sha2-nistp384': return 'ecdsa-sha2-nistp384';
      case 'ecdsa-sha2-nistp521': return 'ecdsa-sha2-nistp521';
      default: return algo;
    }
  }

  /**
   * Detect key type from an OpenSSH-format private key blob.
   */
  private detectOpenSSHKeyType(content: string): { keyType: KeyType; bits: number | null } {
    // The OpenSSH private key format base64-encodes a blob that contains
    // the key type as a length-prefixed string near the start.
    const match = content.match(
      /-----BEGIN OPENSSH PRIVATE KEY-----\s*([\s\S]*?)\s*-----END OPENSSH PRIVATE KEY-----/,
    );
    if (!match) {
      return { keyType: 'ed25519', bits: 256 };
    }

    const raw = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
    const decoded = raw.toString('ascii');

    if (decoded.includes('ssh-ed25519')) {
      return { keyType: 'ed25519', bits: 256 };
    }
    if (decoded.includes('ssh-rsa')) {
      return { keyType: 'rsa', bits: this.estimateRSABitsFromBlob(raw) };
    }
    if (decoded.includes('ecdsa-sha2-nistp256')) {
      return { keyType: 'ecdsa', bits: 256 };
    }
    if (decoded.includes('ecdsa-sha2-nistp384')) {
      return { keyType: 'ecdsa', bits: 384 };
    }
    if (decoded.includes('ecdsa-sha2-nistp521')) {
      return { keyType: 'ecdsa', bits: 521 };
    }

    // Default for ambiguous OpenSSH private keys
    return { keyType: 'ed25519', bits: 256 };
  }

  /**
   * Rough RSA bit estimation from PEM-encoded key length.
   */
  private estimateRSABits(pemContent: string): number | null {
    const match = pemContent.match(
      /-----BEGIN (?:RSA )?PRIVATE KEY-----\s*([\s\S]*?)\s*-----END (?:RSA )?PRIVATE KEY-----/,
    );
    if (!match) return null;

    const der = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
    const byteLength = der.length;

    // Approximate mapping of DER byte length to RSA key size
    if (byteLength > 4500) return 8192;
    if (byteLength > 2300) return 4096;
    if (byteLength > 1600) return 3072;
    if (byteLength > 1100) return 2048;
    if (byteLength > 500) return 1024;
    return null;
  }

  /**
   * Rough RSA bit estimation from OpenSSH raw blob size.
   */
  private estimateRSABitsFromBlob(raw: Buffer): number | null {
    const len = raw.length;
    if (len > 5000) return 8192;
    if (len > 2700) return 4096;
    if (len > 1900) return 3072;
    if (len > 1200) return 2048;
    if (len > 600) return 1024;
    return null;
  }

  /**
   * Rough ECDSA curve size estimation from PEM key data.
   */
  private estimateECDSABits(content: string): number | null {
    if (content.includes('nistp521') || content.includes('secp521r1')) return 521;
    if (content.includes('nistp384') || content.includes('secp384r1')) return 384;
    if (content.includes('nistp256') || content.includes('prime256v1')) return 256;

    // Estimate from PEM key size
    const match = content.match(
      /-----BEGIN EC PRIVATE KEY-----\s*([\s\S]*?)\s*-----END EC PRIVATE KEY-----/,
    );
    if (!match) return null;

    const der = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
    if (der.length > 300) return 521;
    if (der.length > 200) return 384;
    return 256;
  }

  /**
   * Resolve the canonical bit size for a key type.
   */
  private resolveBits(keyType: KeyType, requestedBits?: number): number | null {
    switch (keyType) {
      case 'rsa':
        return requestedBits || 4096;
      case 'ecdsa':
        return requestedBits || 256;
      case 'ed25519':
        return 256;
      default:
        return requestedBits || null;
    }
  }

  /**
   * Create a temporary directory with a random name.
   */
  private async createTempDir(): Promise<string> {
    const dirName = `nexus-keychain-${crypto.randomBytes(12).toString('hex')}`;
    const tempDir = path.join(os.tmpdir(), dirName);
    await fs.mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  /**
   * Securely delete all files in a temp directory.
   * Overwrites each file with random data before unlinking.
   */
  private async secureCleanup(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir);

      for (const entry of entries) {
        const filePath = path.join(dir, entry);
        try {
          const stat = await fs.stat(filePath);
          if (stat.isFile()) {
            // Overwrite with random data
            const randomData = crypto.randomBytes(stat.size || 256);
            await fs.writeFile(filePath, randomData);
            // Second pass: overwrite with zeros
            await fs.writeFile(filePath, Buffer.alloc(stat.size || 256));
            await fs.unlink(filePath);
          } else if (stat.isDirectory()) {
            await this.secureCleanup(filePath);
          }
        } catch {
          // Best-effort: try to remove even if overwrite fails
          try {
            await fs.unlink(filePath);
          } catch {
            // Ignore cleanup errors for individual files
          }
        }
      }

      await fs.rmdir(dir);
    } catch {
      // Ignore errors during cleanup — temp dir may already be gone
    }
  }
}

export const keychainManager = new KeychainManager();
