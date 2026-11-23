/**
 * PTY resizes from a terminal (#5663). The ResizeObserver fires every frame while the window
 * is dragged, and each fire used to send an ssh:resize (a window-change request to the
 * server, and a redraw of whatever runs in the shell). This sends at most one per interval:
 * the first at once, then the latest size when the interval ends. A size equal to the last
 * one sent is dropped.
 *
 * No DOM or Electron: unit-tested (tests/unit/resize-sender.test.ts).
 */

export const RESIZE_INTERVAL_MS = 100;

export interface ResizeSender {
  /** A size from a resize event: sent now or at the end of the current interval. */
  request(cols: number, rows: number): void;
  /** Send now (a view became visible, settings changed), unless it is the size already sent. */
  flush(cols: number, rows: number): void;
  dispose(): void;
}

export function createResizeSender(
  send: (cols: number, rows: number) => void,
  intervalMs: number = RESIZE_INTERVAL_MS,
): ResizeSender {
  let lastSent: string | null = null;
  let pending: [number, number] | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const valid = (cols: number, rows: number) =>
    Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0;

  const sendNow = (cols: number, rows: number) => {
    const key = `${cols}x${rows}`;
    if (key === lastSent) return;
    lastSent = key;
    send(cols, rows);
  };

  const startInterval = () => {
    timer = setTimeout(() => {
      timer = null;
      if (pending) {
        const [c, r] = pending;
        pending = null;
        sendNow(c, r);
        startInterval();
      }
    }, intervalMs);
  };

  return {
    request(cols, rows) {
      if (!valid(cols, rows)) return;
      if (timer) {
        pending = [cols, rows];
        return;
      }
      sendNow(cols, rows);
      startInterval();
    },
    flush(cols, rows) {
      if (!valid(cols, rows)) return;
      pending = null;
      sendNow(cols, rows);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
