import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import {
  EnvelopeEncryptionService,
  type EncryptedValue,
} from './envelope-encryption.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(
  overrides: { kmsKeyArn?: string; devEncryptionKey?: string } = {},
): ConfigService {
  return {
    get: jest.fn().mockReturnValue({
      kmsKeyArn: overrides.kmsKeyArn ?? null,
      devEncryptionKey:
        overrides.devEncryptionKey ?? randomBytes(32).toString('hex'),
    }),
  } as unknown as ConfigService;
}

// ---------------------------------------------------------------------------
// Local dev mode (no KMS)
// ---------------------------------------------------------------------------

describe('local dev mode', () => {
  let svc: EnvelopeEncryptionService;

  beforeEach(() => {
    svc = new EnvelopeEncryptionService(makeConfig());
  });

  it('round-trips encrypt → decrypt', async () => {
    const plaintext = 'super-secret-refresh-token';
    const encrypted = await svc.encrypt(plaintext);
    expect(encrypted.dekId).toBe('local');
    const decrypted = await svc.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces a unique IV on every encrypt call', async () => {
    const a = await svc.encrypt('token');
    const b = await svc.encrypt('token');
    expect(a.iv).not.toBe(b.iv);
  });

  it('produces unique ciphertexts for the same plaintext', async () => {
    const a = await svc.encrypt('token');
    const b = await svc.encrypt('token');
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('throws on tampered ciphertext (GCM auth tag mismatch)', async () => {
    const encrypted = await svc.encrypt('token');
    const buf = Buffer.from(encrypted.ciphertext, 'base64');
    // Flip a byte in the ciphertext body (not the auth tag)
    buf[0] ^= 0xff;
    const tampered: EncryptedValue = {
      ...encrypted,
      ciphertext: buf.toString('base64'),
    };
    await expect(svc.decrypt(tampered)).rejects.toThrow();
  });

  it('throws on tampered IV', async () => {
    const encrypted = await svc.encrypt('token');
    const ivBuf = Buffer.from(encrypted.iv, 'base64');
    ivBuf[0] ^= 0xff;
    const tampered: EncryptedValue = {
      ...encrypted,
      iv: ivBuf.toString('base64'),
    };
    await expect(svc.decrypt(tampered)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// KMS mode (mocked KMS client)
// ---------------------------------------------------------------------------

describe('KMS mode', () => {
  const KEY_ARN = 'arn:aws:kms:us-east-1:123456789012:key/test-key';
  const fakeDek = randomBytes(32);
  const fakeWrappedDek = randomBytes(32);
  const fakeWrappedDekB64 = fakeWrappedDek.toString('base64');

  let sendMock: ReturnType<typeof jest.fn>;
  let svc: EnvelopeEncryptionService;

  beforeEach(async () => {
    // Import the KMS module so we can mock its send method
    const kmsModule = await import('@aws-sdk/client-kms');
    sendMock = jest.fn();
    // Patch KMSClient.prototype.send for all instances
    jest
      .spyOn(kmsModule.KMSClient.prototype, 'send')
      .mockImplementation(sendMock);

    sendMock.mockImplementation((cmd: unknown) => {
      if (
        (cmd as { constructor: { name: string } }).constructor.name ===
        'GenerateDataKeyCommand'
      ) {
        return Promise.resolve({
          Plaintext: fakeDek,
          CiphertextBlob: fakeWrappedDek,
        });
      }
      if (
        (cmd as { constructor: { name: string } }).constructor.name ===
        'DecryptCommand'
      ) {
        return Promise.resolve({ Plaintext: fakeDek });
      }
      return Promise.reject(new Error('unexpected KMS command'));
    });

    svc = new EnvelopeEncryptionService(makeConfig({ kmsKeyArn: KEY_ARN }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls GenerateDataKey on encrypt', async () => {
    const encrypted = await svc.encrypt('token');
    expect(encrypted.dekId).toBe(fakeWrappedDekB64);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].constructor.name).toBe(
      'GenerateDataKeyCommand',
    );
  });

  it('round-trips encrypt → decrypt via KMS', async () => {
    const encrypted = await svc.encrypt('kms-token');
    const decrypted = await svc.decrypt(encrypted);
    expect(decrypted).toBe('kms-token');
    // encrypt = 1 GenerateDataKey; decrypt = 1 Decrypt
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('DEK cache hit avoids a second KMS Decrypt call', async () => {
    const encrypted = await svc.encrypt('token');
    await svc.decrypt(encrypted); // cache miss — calls KMS.Decrypt
    await svc.decrypt(encrypted); // cache hit — no KMS call
    // 1 GenerateDataKey + 1 Decrypt (not 2)
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('propagates KMS GenerateDataKey failure', async () => {
    sendMock.mockRejectedValueOnce(new Error('KMS unavailable'));
    await expect(svc.encrypt('token')).rejects.toThrow('KMS unavailable');
  });

  it('propagates KMS Decrypt failure', async () => {
    const encrypted = await svc.encrypt('token');
    sendMock.mockRejectedValueOnce(new Error('KMS key disabled'));
    // Clear cache so decrypt actually calls KMS
    (svc as unknown as { dekCache: Map<string, unknown> }).dekCache.clear();
    await expect(svc.decrypt(encrypted)).rejects.toThrow('KMS key disabled');
  });
});
