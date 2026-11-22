import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FieldCrypto, FieldCryptoError, maskTail } from '../../src/lib/field-crypto.js';

const key = (kid: string) => ({ kid, secret: randomBytes(32) });

describe('FieldCrypto', () => {
  it('round-trips and never stores the plaintext', () => {
    const fc = new FieldCrypto([key('f1')]);
    const blob = fc.encrypt('ABCPM1234F', 'owner:u1:pan');
    expect(blob.toString('utf8')).not.toContain('ABCPM1234F');
    expect(fc.decrypt(blob, 'owner:u1:pan')).toBe('ABCPM1234F');
  });

  it('uses a fresh IV each time', () => {
    const fc = new FieldCrypto([key('f1')]);
    expect(fc.encrypt('same', 'ctx').equals(fc.encrypt('same', 'ctx'))).toBe(false);
  });

  it('refuses ciphertext moved to another row or column', () => {
    const fc = new FieldCrypto([key('f1')]);
    const blob = fc.encrypt('123456789012', 'owner:u1:bank_account');
    expect(() => fc.decrypt(blob, 'owner:u2:bank_account')).toThrow(FieldCryptoError);
    expect(() => fc.decrypt(blob, 'owner:u1:pan')).toThrow(FieldCryptoError);
  });

  it('detects tampering', () => {
    const fc = new FieldCrypto([key('f1')]);
    const blob = fc.encrypt('SBIN0001234', 'ctx');
    blob[blob.length - 1] = blob[blob.length - 1]! ^ 0xff;
    expect(() => fc.decrypt(blob, 'ctx')).toThrow(FieldCryptoError);
  });

  it('decrypts with retired keys and flags them for re-encryption', () => {
    const old = key('f1');
    const before = new FieldCrypto([old]);
    const blob = before.encrypt('ABCPM1234F', 'ctx');
    const after = new FieldCrypto([key('f2'), old]);
    expect(after.decrypt(blob, 'ctx')).toBe('ABCPM1234F');
    expect(after.needsReencrypt(blob)).toBe(true);
    expect(after.needsReencrypt(after.encrypt('x', 'ctx'))).toBe(false);
    expect(() => new FieldCrypto([key('f2')]).decrypt(blob, 'ctx')).toThrow(/unknown key/);
  });

  it('rejects keys that are not 256-bit', () => {
    expect(() => new FieldCrypto([{ kid: 'k', secret: randomBytes(16) }])).toThrow();
  });
});

describe('maskTail', () => {
  it('keeps only the last four characters', () => {
    expect(maskTail('ABCPM1234F')).toBe('XXXXXX234F');
    expect(maskTail('123456789012')).toBe('XXXXXXXX9012');
    expect(maskTail('123')).toBe('123');
  });
});
