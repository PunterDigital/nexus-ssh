import { randomBytes } from 'crypto';
import { describe, expect, it } from 'vitest';
import { PinStore, PinUnlockError } from '../../src/main/vault/pin-unlock';
import { PIN_MAX_ATTEMPTS } from '../../src/shared/constants';

const VAULT = '/vaults/Work.db';

async function storeWithPin(password: string | null = 'master pass') {
  const store = new PinStore();
  const dbKey = randomBytes(32);
  await store.setup(VAULT, '1234', dbKey, password);
  return { store, dbKey };
}

async function wrongPin(store: PinStore): Promise<PinUnlockError> {
  const err = await store.unlock(VAULT, '9999').catch((e: unknown) => e);
  expect(err).toBeInstanceOf(PinUnlockError);
  return err as PinUnlockError;
}

describe('PinStore', () => {
  it('allows five wrong tries', () => {
    expect(PIN_MAX_ATTEMPTS).toBe(5);
  });

  it('is off until a PIN is set up', async () => {
    const store = new PinStore();
    expect(store.status(VAULT)).toEqual({ enabled: false, attemptsLeft: 0 });
    await expect(store.unlock(VAULT, '1234')).rejects.toThrow(/not set up/);
  });

  it('returns the vault key and password for the right PIN', async () => {
    const { store, dbKey } = await storeWithPin();
    expect(store.status(VAULT)).toEqual({ enabled: true, attemptsLeft: PIN_MAX_ATTEMPTS });
    const secrets = await store.unlock(VAULT, '1234');
    expect(secrets.dbKey.equals(dbKey)).toBe(true);
    expect(secrets.password).toBe('master pass');
  });

  it('works for a vault opened without a password (hardware key)', async () => {
    const { store } = await storeWithPin(null);
    expect((await store.unlock(VAULT, '1234')).password).toBeNull();
  });

  it('keeps its own copy of the key, so zeroing the caller buffer is safe', async () => {
    const { store, dbKey } = await storeWithPin();
    const copy = Buffer.from(dbKey);
    dbKey.fill(0);
    expect((await store.unlock(VAULT, '1234')).dbKey.equals(copy)).toBe(true);
  });

  it('only accepts 4 to 8 digits', async () => {
    const store = new PinStore();
    for (const pin of ['123', '123456789', '12a4', '', ' 1234']) {
      await expect(store.setup(VAULT, pin, randomBytes(32), null)).rejects.toThrow(/4 to 8 digits/);
    }
    await store.setup(VAULT, '12345678', randomBytes(32), null);
    expect(store.status(VAULT).enabled).toBe(true);
  });

  it('counts wrong PINs and turns PIN unlock off after the last one', async () => {
    const { store } = await storeWithPin();
    for (let left = PIN_MAX_ATTEMPTS - 1; left > 0; left--) {
      const err = await wrongPin(store);
      expect(err.attemptsLeft).toBe(left);
      expect(err.message).toBe(`Wrong PIN. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`);
      expect(store.status(VAULT)).toEqual({ enabled: true, attemptsLeft: left });
    }
    const last = await wrongPin(store);
    expect(last.attemptsLeft).toBe(0);
    expect(last.message).toMatch(/Too many wrong PINs/);
    expect(store.status(VAULT).enabled).toBe(false);
    // Even the right PIN does nothing now
    await expect(store.unlock(VAULT, '1234')).rejects.toThrow(/not set up/);
  });

  it('resets the count after a right PIN', async () => {
    const { store } = await storeWithPin();
    await wrongPin(store);
    await wrongPin(store);
    await store.unlock(VAULT, '1234');
    expect(store.status(VAULT).attemptsLeft).toBe(PIN_MAX_ATTEMPTS);
  });

  it('changing the PIN replaces the old one and resets the count', async () => {
    const { store, dbKey } = await storeWithPin();
    await wrongPin(store);
    await store.setup(VAULT, '55667788', dbKey, 'master pass');
    expect(store.status(VAULT).attemptsLeft).toBe(PIN_MAX_ATTEMPTS);
    // The old PIN is wrong now
    await expect(store.unlock(VAULT, '1234')).rejects.toBeInstanceOf(PinUnlockError);
    expect((await store.unlock(VAULT, '55667788')).dbKey.equals(dbKey)).toBe(true);
  });

  it('keeps PINs per vault', async () => {
    const { store } = await storeWithPin();
    expect(store.status('/vaults/Home.db').enabled).toBe(false);
    await store.setup('/vaults/Home.db', '4321', randomBytes(32), null);
    await wrongPin(store);
    expect(store.status('/vaults/Home.db').attemptsLeft).toBe(PIN_MAX_ATTEMPTS);
  });

  it('clear turns it off; rename keeps it under the new path', async () => {
    const { store, dbKey } = await storeWithPin();
    store.rename(VAULT, '/vaults/Client.db');
    expect(store.status(VAULT).enabled).toBe(false);
    expect((await store.unlock('/vaults/Client.db', '1234')).dbKey.equals(dbKey)).toBe(true);
    store.clear('/vaults/Client.db');
    expect(store.status('/vaults/Client.db').enabled).toBe(false);
  });

  it('a new store (a restart) knows no PINs', async () => {
    await storeWithPin();
    expect(new PinStore().status(VAULT).enabled).toBe(false);
  });
});
