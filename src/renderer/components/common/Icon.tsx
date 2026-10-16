import type { LucideIcon, LucideProps } from 'lucide-react';

// Every icon in the app is a Lucide icon (https://lucide.dev) rendered through <Icon>, so they all
// share one 24px grid, stroke width and alignment. Pick the icon by name:
//   import { Terminal } from 'lucide-react';
//   <Icon icon={Terminal} size={14} />
// Don't hand-draw SVG icons. The only exceptions are brand logos Lucide doesn't ship; give their
// svg element a data-logo attribute (tests/unit/icons.test.ts enforces this).

/** Default icon size in px. Most toolbar, list and menu icons use this. */
export const ICON_SIZE = 14;
/** Lucide's own stroke width on its 24px grid. Large empty-state icons may go thinner (1.5). */
export const ICON_STROKE = 2;

export interface IconProps extends Omit<LucideProps, 'ref'> {
  icon: LucideIcon;
  size?: number;
}

export function Icon({ icon: LucideComponent, size = ICON_SIZE, strokeWidth = ICON_STROKE, className, ...rest }: IconProps) {
  return (
    <LucideComponent
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden="true"
      focusable="false"
      className={className ? `shrink-0 ${className}` : 'shrink-0'}
      {...rest}
    />
  );
}
