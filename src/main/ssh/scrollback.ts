/**
 * A session's PTY output as main keeps it for replay (#5663).
 *
 * Main used to keep every chunk for the life of the session, so a `tail -f` or a long build
 * log grew without limit, and each remount replayed all of it though xterm keeps only its
 * own scrollback. This keeps the newest output up to a character budget. Trimming cuts at a
 * line start where it can, so a replay starts on a whole line.
 *
 * No Electron imports: unit-tested (tests/unit/ssh-scrollback.test.ts).
 */

/** About 4 MB of UTF-16: far more than xterm's default 10,000 lines of an 80-column terminal. */
export const SCROLLBACK_MAX_CHARS = 2 * 1024 * 1024;

export class Scrollback {
  private chunks: string[] = [];
  private total = 0;

  constructor(private readonly maxChars: number = SCROLLBACK_MAX_CHARS) {}

  /** A copy (a reconnect continues the old output). */
  clone(): Scrollback {
    const copy = new Scrollback(this.maxChars);
    copy.chunks = [...this.chunks];
    copy.total = this.total;
    return copy;
  }

  push(text: string): void {
    if (!text) return;
    this.chunks.push(text);
    this.total += text.length;
    if (this.total > this.maxChars) this.trim();
  }

  get length(): number {
    return this.total;
  }

  /** Everything kept, oldest first. Joined once and kept as one chunk, so remounts are cheap. */
  text(): string {
    if (this.chunks.length > 1) this.chunks = [this.chunks.join('')];
    return this.chunks[0] ?? '';
  }

  private trim(): void {
    let excess = this.total - this.maxChars;
    // Whole chunks first.
    while (this.chunks.length > 0 && this.chunks[0].length <= excess) {
      const dropped = this.chunks.shift()!;
      this.total -= dropped.length;
      excess -= dropped.length;
    }
    if (excess > 0 && this.chunks.length > 0) {
      const head = this.chunks[0];
      // Cut after the next newline past the excess, if one is near; else exactly at the excess.
      const newline = head.indexOf('\n', excess);
      const cut = newline >= 0 && newline - excess < 4096 ? newline + 1 : excess;
      this.chunks[0] = head.slice(cut);
      this.total -= cut;
      if (this.chunks[0].length === 0) this.chunks.shift();
    }
  }
}
