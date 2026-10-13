import { describe, expect, it } from 'vitest';
import { IPC } from '../../src/shared/constants';

describe('IPC channel names', () => {
  it('are unique so handlers never collide', () => {
    const channels = Object.values(IPC);
    expect(new Set(channels).size).toBe(channels.length);
  });
});
