/**
 * Reconnect loop for a dropped terminal session (#4322): up to three attempts with exponential
 * backoff (1 s, 2 s, 4 s), then it gives up until the user asks for another round.
 * No React or IPC here: the caller passes `connect`, so it is unit-tested with fake timers.
 *
 * One attempt runs at a time. A successful attempt always wins, even one that was under way
 * when the user pressed Stop: the session is back, so there is nothing left to stop.
 */

/** Wait before attempt 1, 2 and 3. */
export const RECONNECT_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000];

export type ReconnectState =
  /** Counting down to `attempt`. */
  | { phase: 'waiting'; attempt: number; total: number; retryAt: number; error: string }
  /** Attempt `attempt` is under way. */
  | { phase: 'connecting'; attempt: number; total: number; error: string }
  /** All attempts in the round failed. */
  | { phase: 'failed'; total: number; error: string }
  /** The user stopped retrying. */
  | { phase: 'stopped'; error: string };

export interface ReconnectLoopOptions {
  connect: () => Promise<void>;
  /** Every state change; `null` once connected again. */
  onChange: (state: ReconnectState | null) => void;
  delays?: readonly number[];
  now?: () => number;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class ReconnectLoop {
  private readonly delays: readonly number[];
  private readonly now: () => number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private state: ReconnectState | null = null;
  private disposed = false;
  /** Bumped by every new round, so a failure from an older round is ignored. */
  private round = 0;
  private attempt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly opts: ReconnectLoopOptions) {
    this.delays = opts.delays ?? RECONNECT_DELAYS_MS;
    this.now = opts.now ?? Date.now;
  }

  get current(): ReconnectState | null {
    return this.state;
  }

  /** Start a round of attempts (after the drop, or "Try again"). */
  start(error: string): void {
    if (this.disposed) return;
    this.clearTimer();
    this.round += 1;
    this.attempt = 0;
    this.scheduleNext(error);
  }

  /** "Reconnect now": skip the countdown. */
  skipWait(): void {
    if (this.state?.phase !== 'waiting') return;
    this.clearTimer();
    void this.run(this.state.error);
  }

  /** Stop retrying. */
  stop(): void {
    if (!this.state || this.state.phase === 'stopped') return;
    this.clearTimer();
    this.set({ phase: 'stopped', error: this.state.error });
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private scheduleNext(error: string): void {
    const total = this.delays.length;
    if (this.attempt >= total) {
      this.set({ phase: 'failed', total, error });
      return;
    }
    const delay = this.delays[this.attempt];
    this.set({ phase: 'waiting', attempt: this.attempt + 1, total, retryAt: this.now() + delay, error });
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(error);
    }, delay);
  }

  private async run(error: string): Promise<void> {
    if (this.inFlight) {
      // An attempt from before a Stop is still running: let it finish first.
      await this.inFlight.catch(() => {});
      if (this.disposed || this.state === null) return;
    }
    const round = this.round;
    const total = this.delays.length;
    this.attempt += 1;
    this.set({ phase: 'connecting', attempt: this.attempt, total, error });

    const attempt = this.opts.connect();
    this.inFlight = attempt;
    try {
      await attempt;
      if (this.disposed) return;
      this.clearTimer();
      this.set(null);
    } catch (err) {
      if (this.disposed || round !== this.round) return;
      if (this.state?.phase === 'stopped') this.set({ phase: 'stopped', error: message(err) });
      else this.scheduleNext(message(err));
    } finally {
      if (this.inFlight === attempt) this.inFlight = null;
    }
  }

  private set(state: ReconnectState | null): void {
    this.state = state;
    if (!this.disposed) this.opts.onChange(state);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
