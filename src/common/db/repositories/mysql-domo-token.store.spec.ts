import { jest } from '@jest/globals';
import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { MysqlDomoTokenStore } from './mysql-domo-token.store';
import { EnvelopeEncryptionService } from '../../crypto/envelope-encryption.service';
import type { Db } from '../db.module';
import type { DomoOAuthTokens } from '../../auth/domo-link/types';
import { uuidToBinary } from '../uuid';

const LINK_ID = '12345678-1234-1234-1234-123456789012';
const SCOPE = 'ai:read';
const TOKEN = 'plaintext-refresh-token';
const NOW = new Date('2025-01-01T00:00:00Z');

function makeCrypto(): EnvelopeEncryptionService {
  const config = {
    get: jest.fn().mockReturnValue({
      kmsKeyArn: null,
      devEncryptionKey: randomBytes(32).toString('hex'),
    }),
  } as unknown as ConfigService;
  return new EnvelopeEncryptionService(config);
}

function makeDb(selectResult: unknown[] = []) {
  const selectChain = {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(selectResult),
  };
  const onDupUpdate = jest.fn().mockResolvedValue({});
  const insertValues = jest
    .fn()
    .mockReturnValue({ onDuplicateKeyUpdate: onDupUpdate });
  const deleteChain = { where: jest.fn().mockResolvedValue({}) };
  const db = {
    select: jest.fn().mockReturnValue(selectChain),
    insert: jest.fn().mockReturnValue({ values: insertValues }),
    delete: jest.fn().mockReturnValue(deleteChain),
  };
  return { db, selectChain, insertValues, onDupUpdate, deleteChain };
}

function makeRecord(overrides: Partial<DomoOAuthTokens> = {}): DomoOAuthTokens {
  return {
    linkId: LINK_ID,
    refreshToken: TOKEN,
    scope: SCOPE,
    updatedAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// get()
// ---------------------------------------------------------------------------

describe('MysqlDomoTokenStore.get()', () => {
  it('returns null when no row exists', async () => {
    const { db } = makeDb([]);
    const store = new MysqlDomoTokenStore(db as unknown as Db, makeCrypto());
    expect(await store.get(LINK_ID)).toBeNull();
  });

  it('returns plaintext token for pre-migration row (null refreshDekId)', async () => {
    const row = {
      linkId: uuidToBinary(LINK_ID),
      refreshToken: TOKEN,
      refreshIv: null,
      refreshDekId: null,
      scope: SCOPE,
      updatedAt: NOW,
    };
    const { db } = makeDb([row]);
    const store = new MysqlDomoTokenStore(db as unknown as Db, makeCrypto());
    const result = await store.get(LINK_ID);
    expect(result?.refreshToken).toBe(TOKEN);
    expect(result?.linkId).toBe(LINK_ID);
    expect(result?.scope).toBe(SCOPE);
  });

  it('returns plaintext token for pre-migration row (null refreshIv only)', async () => {
    const row = {
      linkId: uuidToBinary(LINK_ID),
      refreshToken: TOKEN,
      refreshIv: null,
      refreshDekId: 'local',
      scope: SCOPE,
      updatedAt: NOW,
    };
    const { db } = makeDb([row]);
    const store = new MysqlDomoTokenStore(db as unknown as Db, makeCrypto());
    const result = await store.get(LINK_ID);
    expect(result?.refreshToken).toBe(TOKEN);
  });

  it('decrypts token for encrypted row (local dev mode)', async () => {
    const crypto = makeCrypto();
    const encrypted = await crypto.encrypt(TOKEN);
    const row = {
      linkId: uuidToBinary(LINK_ID),
      refreshToken: encrypted.ciphertext,
      refreshIv: encrypted.iv,
      refreshDekId: encrypted.dekId,
      scope: SCOPE,
      updatedAt: NOW,
    };
    const { db } = makeDb([row]);
    const store = new MysqlDomoTokenStore(db as unknown as Db, crypto);
    const result = await store.get(LINK_ID);
    expect(result?.refreshToken).toBe(TOKEN);
  });

  it('propagates decryption error on tampered ciphertext', async () => {
    const crypto = makeCrypto();
    const encrypted = await crypto.encrypt(TOKEN);
    const buf = Buffer.from(encrypted.ciphertext, 'base64');
    buf[0] ^= 0xff;
    const row = {
      linkId: uuidToBinary(LINK_ID),
      refreshToken: buf.toString('base64'),
      refreshIv: encrypted.iv,
      refreshDekId: encrypted.dekId,
      scope: SCOPE,
      updatedAt: NOW,
    };
    const { db } = makeDb([row]);
    const store = new MysqlDomoTokenStore(db as unknown as Db, crypto);
    await expect(store.get(LINK_ID)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// upsert()
// ---------------------------------------------------------------------------

describe('MysqlDomoTokenStore.upsert()', () => {
  it('encrypts the token before writing to the DB', async () => {
    const crypto = makeCrypto();
    const encryptSpy = jest.spyOn(crypto, 'encrypt');
    const { db, insertValues } = makeDb();
    const store = new MysqlDomoTokenStore(db as unknown as Db, crypto);

    await store.upsert(makeRecord());

    expect(encryptSpy).toHaveBeenCalledWith(TOKEN);
    const written = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(written.refreshToken).not.toBe(TOKEN);
    expect(written.refreshDekId).toBe('local');
    expect(written.refreshIv).toBeDefined();
  });

  it('returns the original unencrypted record', async () => {
    const { db } = makeDb();
    const store = new MysqlDomoTokenStore(db as unknown as Db, makeCrypto());
    const record = makeRecord();
    const result = await store.upsert(record);
    expect(result).toEqual(record);
  });
});
