/** Joins class names, skipping falsy values: cx('a', cond && 'b'). */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** Elements that can take keyboard focus (used by Dialog, Menu and Toolbar). */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
