/**
 * Windowing for fixed-height list rows (#5667): the SFTP panes render only the rows in view
 * (plus a few either side) instead of one DOM row per entry. Plain maths, no library;
 * unit-tested (tests/unit/virtual-rows.test.ts).
 */

export interface RowWindow {
  /** First rendered row. */
  start: number;
  /** One past the last rendered row. */
  end: number;
}

export interface RowGeometry {
  rowHeight: number;
  /** Rows rendered beyond each edge of the viewport. */
  overscan: number;
  /** Padding above the first row (inside the scrolled content). */
  padTop: number;
}

/** The rows to render for a viewport `[scrollTop, scrollTop + height)` over `count` rows. */
export function visibleRows(
  scrollTop: number,
  height: number,
  count: number,
  g: RowGeometry,
): RowWindow {
  if (count <= 0) return { start: 0, end: 0 };
  const top = Math.max(0, scrollTop - g.padTop);
  const first = Math.floor(top / g.rowHeight);
  const last = Math.ceil((top + Math.max(0, height)) / g.rowHeight);
  return {
    start: Math.max(0, Math.min(count - 1, first - g.overscan)),
    end: Math.min(count, Math.max(first + 1, last) + g.overscan),
  };
}

/** The scrollTop that brings row `index` fully into view, or the current one if it already is. */
export function revealRow(
  index: number,
  scrollTop: number,
  height: number,
  g: Pick<RowGeometry, 'rowHeight' | 'padTop'>,
): number {
  const rowTop = g.padTop + index * g.rowHeight;
  const rowBottom = rowTop + g.rowHeight;
  if (rowTop < scrollTop) return rowTop;
  if (rowBottom > scrollTop + height) return Math.max(0, rowBottom - height);
  return scrollTop;
}
