import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { KeyRingEntry } from '../config/env.js';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 1;

export class FieldCryptoError extends Error {
  override name = 'FieldCryptoError';
}

/**
 * AES-256-GCM encryption for sensitive columns (PAN, bank account, IFSC).
 *
 * Layout: [version 1B][kid length 1B][kid][iv 12B][tag 16B][ciphertext].
 * The first key in the ring encrypts; any key decrypts, so keys rotate by prepending.
 * The associated data binds each ciphertext to its column and row, so a value copied
 * into another owner's row or another column fails to decrypt.
 */
export class FieldCrypto {
  private readonly keys: Map<string, Buffer>;
  private readonly current: KeyRingEntry;

  constructor(ring: KeyRingEntry[]) {
    const [current] = ring;
    if (!current) throw new FieldCryptoError('encryption key ring is empty');
    for (const k of ring) {
      if (k.secret.length !== 32)
        throw new FieldCryptoError(`key "${k.kid}" must be exactly 32 bytes`);
    }
    this.current = current;
    this.keys = new Map(ring.map((k) => [k.kid, k.secret]));
  }

  encrypt(plaintext: string, context: string): Buffer {
    const kid = Buffer.from(this.current.kid, 'utf8');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.current.secret, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION, kid.length]), kid, iv, cipher.getAuthTag(), data]);
  }

  decrypt(blob: Buffer, context: string): string {
    if (blob.length < 2 || blob[0] !== VERSION)
      throw new FieldCryptoError('unsupported ciphertext');
    const kidLength = blob.readUInt8(1);
    const kidEnd = 2 + kidLength;
    const kid = blob.subarray(2, kidEnd).toString('utf8');
    const key = this.keys.get(kid);
    if (!key) throw new FieldCryptoError(`unknown key "${kid}"`);
    const iv = blob.subarray(kidEnd, kidEnd + IV_BYTES);
    const tag = blob.subarray(kidEnd + IV_BYTES, kidEnd + IV_BYTES + TAG_BYTES);
    const data = blob.subarray(kidEnd + IV_BYTES + TAG_BYTES);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch {
      throw new FieldCryptoError('ciphertext failed authentication');
    }
  }

  /** True when the value was encrypted with an older key and should be re-encrypted. */
  needsReencrypt(blob: Buffer): boolean {
    const kidLength = blob[1] ?? 0;
    return blob.subarray(2, 2 + kidLength).toString('utf8') !== this.current.kid;
  }
}

/** "ABCPM1234F" → "XXXXXX234F"; keeps only the last 4 characters. */
export function maskTail(value: string, visible = 4): string {
  return value.length <= visible
    ? value
    : 'X'.repeat(value.length - visible) + value.slice(-visible);
}
