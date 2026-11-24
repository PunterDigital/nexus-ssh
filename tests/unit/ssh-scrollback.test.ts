import { describe, expect, it } from 'vitest';
import { StringDecoder } from 'node:string_decoder';
import { Scrollback, SCROLLBACK_MAX_CHARS } from '../../src/main/ssh/scrollback';

// #5663: main kept every PTY chunk for the life of a session and replayed all of it.

describe('Scrollback', () => {
  it('keeps everything while under the budget', () => {
    const s = new Scrollback(100);
    s.push('hello ');
    s.push('world');
    expect(s.text()).toBe('hello world');
    expect(s.length).toBe(11);
  });

  it('stays within its budget through 50 MB of output and keeps the newest lines', () => {
    const s = new Scrollback();
    const line = (n: number) => `line ${String(n).padStart(8, '0')} ${'x'.repeat(100)}\r\n`;
    let pushed = 0;
    let n = 0;
    while (pushed < 50 * 1024 * 1024) {
      // ~16 KB chunks, as ssh2 delivers them
      let chunk = '';
      while (chunk.length < 16 * 1024) chunk += line(n++);
      s.push(chunk);
      pushed += chunk.length;
      expect(s.length).toBeLessThanOrEqual(SCROLLBACK_MAX_CHARS);
    }
    const text = s.text();
    expect(text.length).toBeLessThanOrEqual(SCROLLBACK_MAX_CHARS);
    expect(text.length).toBeGreaterThan(SCROLLBACK_MAX_CHARS - 20 * 1024);
    expect(text.endsWith(line(n - 1))).toBe(true);
    // Trimmed at a line start, so the replay begins with a whole line.
    expect(text.startsWith('line ')).toBe(true);
  });

  it('trims one huge chunk too', () => {
    const s = new Scrollback(1000);
    s.push('a\n'.repeat(5000));
    expect(s.length).toBeLessThanOrEqual(1000);
    expect(s.text().startsWith('a\n')).toBe(true);
  });

  it('cuts mid-line when there is no newline near', () => {
    const s = new Scrollback(10);
    s.push('0123456789abcdef');
    expect(s.text()).toBe('6789abcdef');
  });

  it('clones independently (a reconnect continues the old output)', () => {
    const s = new Scrollback(100);
    s.push('before');
    const c = s.clone();
    c.push(' after');
    expect(s.text()).toBe('before');
    expect(c.text()).toBe('before after');
  });
});

describe('PTY decoding', () => {
  it('a UTF-8 character split across two chunks comes out whole with a StringDecoder', () => {
    const bytes = Buffer.from('café ✓ 🎉', 'utf8');
    // Split inside the 4-byte emoji and inside the 3-byte check mark.
    const parts = [bytes.subarray(0, 8), bytes.subarray(8, bytes.length - 2), bytes.subarray(bytes.length - 2)];
    const naive = parts.map((p) => p.toString('utf8')).join('');
    expect(naive).toContain('�'); // what main did before
    const decoder = new StringDecoder('utf8');
    expect(parts.map((p) => decoder.write(p)).join('') + decoder.end()).toBe('café ✓ 🎉');
  });
});
