import { describe, it, expect, afterEach } from 'vitest';
import {
  databaseHost,
  extraAllowedHosts,
  isSafeDatabaseHost,
  assertSafeDatabase,
} from '../src/config/dbGuard.js';

/** Ticket 0.B1 — la garde est du pur calcul, sans base de données. */
describe('dbGuard (ticket 0.B1)', () => {
  it("extrait l'hôte d'une URL postgres (IPv6 comprise)", () => {
    expect(databaseHost('postgresql://u:p@localhost:5432/t?schema=public')).toBe('localhost');
    expect(databaseHost('postgresql://u:p@127.0.0.1:5432/t')).toBe('127.0.0.1');
    expect(databaseHost('postgresql://u:p@[::1]:5432/t')).toBe('::1');
  });

  it('renvoie null pour une URL absente ou illisible', () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(databaseHost()).toBeNull(); // aucun DATABASE_URL dans l'env
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
    }
    expect(databaseHost('')).toBeNull();
    expect(databaseHost('pas-une-url')).toBeNull();
  });

  it('autorise loopback, refuse tout le reste par défaut', () => {
    expect(isSafeDatabaseHost('localhost', [])).toBe(true);
    expect(isSafeDatabaseHost('127.0.0.1', [])).toBe(true);
    expect(isSafeDatabaseHost('::1', [])).toBe(true);
    expect(isSafeDatabaseHost('db.prod.example.com', [])).toBe(false);
    // Régression clé : un hôte nommé contenant « test » ne suffit PLUS.
    expect(isSafeDatabaseHost('test-local', [])).toBe(false);
    expect(isSafeDatabaseHost(null, [])).toBe(false);
  });

  it('DB_TEST_HOSTS est la seule allowlist explicite', () => {
    expect(extraAllowedHosts('a.com, B.com ,')).toEqual(['a.com', 'b.com']);
    expect(isSafeDatabaseHost('test-local', ['test-local'])).toBe(true);
  });

  describe('assertSafeDatabase', () => {
    const prevUrl = process.env.DATABASE_URL;
    const prevHosts = process.env.DB_TEST_HOSTS;
    afterEach(() => {
      if (prevUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevUrl;
      if (prevHosts === undefined) delete process.env.DB_TEST_HOSTS;
      else process.env.DB_TEST_HOSTS = prevHosts;
    });

    it('autorise une base locale', () => {
      process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/t';
      delete process.env.DB_TEST_HOSTS;
      expect(() => assertSafeDatabase('x')).not.toThrow();
    });

    it('refuse un hôte de prod, même nommé « test »', () => {
      process.env.DATABASE_URL = 'postgresql://u:p@vps-test.prod.net:5432/t';
      process.env.DB_TEST_HOSTS = '';
      expect(() => assertSafeDatabase('x')).toThrow(/0\.B1/);
    });

    it('autorise un hôte nommé seulement via DB_TEST_HOSTS', () => {
      process.env.DATABASE_URL = 'postgresql://u:p@test-local:5432/t';
      process.env.DB_TEST_HOSTS = 'test-local';
      expect(() => assertSafeDatabase('x')).not.toThrow();
    });

    it("refuse une URL absente", () => {
      delete process.env.DATABASE_URL;
      delete process.env.DB_TEST_HOSTS;
      expect(() => assertSafeDatabase('x')).toThrow(/0\.B1/);
    });
  });
});
