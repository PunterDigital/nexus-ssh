import { describe, expect, it } from 'vitest';
import {
  joinRemote,
  locateRemote,
  normaliseRemoteDir,
  remoteDirChain,
} from '../../src/main/sync/backends/remote-dir';

describe('sync Remote Path helpers', () => {
  it('normalises the configured folder', () => {
    expect(normaliseRemoteDir(undefined)).toBe('');
    expect(normaliseRemoteDir('  ')).toBe('');
    expect(normaliseRemoteDir('~')).toBe('');
    expect(normaliseRemoteDir('/home/me/nexus-sync/')).toBe('/home/me/nexus-sync');
    expect(normaliseRemoteDir('~/nexus')).toBe('nexus');
    expect(normaliseRemoteDir('sync\\nexus')).toBe('sync/nexus');
    expect(normaliseRemoteDir('/')).toBe('/');
  });

  it('joins names onto the folder', () => {
    expect(joinRemote('', 'v.db')).toBe('v.db');
    expect(joinRemote('/', 'v.db')).toBe('/v.db');
    expect(joinRemote('/a/b', 'v.db')).toBe('/a/b/v.db');
    expect(joinRemote('a', 'v.db')).toBe('a/v.db');
  });

  it('lists the folders to create, outermost first', () => {
    expect(remoteDirChain('')).toEqual([]);
    expect(remoteDirChain('/')).toEqual([]);
    expect(remoteDirChain('/a/b')).toEqual(['/a', '/a/b']);
    expect(remoteDirChain('a/b')).toEqual(['a', 'a/b']);
  });

  it('prefers the folder and falls back to the old location', async () => {
    const has = (paths: string[]) => async (p: string) => paths.includes(p);
    expect(await locateRemote('d', 'v.db', has(['d/v.db', 'v.db']))).toBe('d/v.db');
    expect(await locateRemote('d', 'v.db', has(['v.db']))).toBe('v.db');
    expect(await locateRemote('d', 'v.db', has([]))).toBe('d/v.db');
    expect(await locateRemote('', 'v.db', has([]))).toBe('v.db');
  });
});
