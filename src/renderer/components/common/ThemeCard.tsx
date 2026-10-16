import type React from 'react';
import { Check } from 'lucide-react';
import type { NexusTheme } from '../../../shared/types';
import { cx } from '../ui/cx';
import { Icon } from './Icon';

// ============================================================
// ThemeCard — a theme in the settings theme picker: a preview of its palette and its name.
// It is one radio of a role="radiogroup" (SettingsPanel's ThemePicker handles the arrow keys).
// ============================================================

export interface ThemeCardProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  theme: NexusTheme;
  selected: boolean;
  onClick: (theme: NexusTheme) => void;
  ref?: React.Ref<HTMLButtonElement>;
}

export function ThemeCard({ theme, selected, onClick, className, ...rest }: ThemeCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onClick(theme)}
      className={cx(
        'flex min-w-0 flex-col gap-2 rounded-lg border p-2 text-left focus-ring',
        'transition-colors duration-(--duration-fast) ease-standard',
        selected
          ? 'border-accent bg-accent-soft'
          : 'border-line hover:border-line-strong hover:bg-surface-hover',
        className,
      )}
      {...rest}
    >
      <ThemePreview theme={theme} />
      <span
        className={cx(
          'flex min-w-0 items-center gap-1.5 text-body-sm font-medium',
          selected ? 'text-accent' : 'text-fg-secondary',
        )}
      >
        {selected && <Icon icon={Check} size={12} />}
        <span className="truncate">{theme.name}</span>
      </span>
    </button>
  );
}

/** A miniature window (sidebar, accent bar, terminal lines) painted in the theme's own colours. */
function ThemePreview({ theme }: { theme: NexusTheme }) {
  const { ui, terminal } = theme;
  // The preview shows *that* theme's palette, not the active one, so its colours are data: they
  // go in as custom properties on one element and the children read them with bg-(--…).
  const palette = {
    '--preview-app': ui.bgPrimary,
    '--preview-sidebar': ui.bgSecondary,
    '--preview-muted': ui.textMuted,
    '--preview-accent': ui.accent,
    '--preview-term': terminal.background,
    '--preview-fg': terminal.foreground,
    '--preview-green': terminal.green,
    '--preview-cyan': terminal.cyan,
    '--preview-yellow': terminal.yellow,
    '--preview-red': terminal.red,
    '--preview-blue': terminal.blue,
  } as React.CSSProperties;

  return (
    <div
      aria-hidden="true"
      // eslint-disable-next-line no-restricted-syntax -- the theme's palette is data (see above)
      style={palette}
      className="flex aspect-video w-full overflow-hidden rounded-md border border-line bg-(--preview-app)"
    >
      <div className="flex w-1/4 flex-col gap-1 bg-(--preview-sidebar) p-1.5">
        <span className="h-1 w-3/4 rounded-full bg-(--preview-muted)" />
        <span className="h-1 w-3/4 rounded-full bg-(--preview-accent)" />
        <span className="h-1 w-1/2 rounded-full bg-(--preview-muted)" />
      </div>
      <div className="flex flex-1 flex-col">
        <div className="h-1 bg-(--preview-accent)" />
        <div className="flex flex-1 flex-col gap-1 bg-(--preview-term) p-1.5">
          <span className="flex gap-1">
            <span className="h-1 w-1/6 rounded-full bg-(--preview-green)" />
            <span className="h-1 w-1/3 rounded-full bg-(--preview-fg)" />
          </span>
          <span className="flex gap-1">
            <span className="h-1 w-1/6 rounded-full bg-(--preview-cyan)" />
            <span className="h-1 w-1/4 rounded-full bg-(--preview-yellow)" />
          </span>
          <span className="flex gap-1">
            <span className="h-1 w-1/5 rounded-full bg-(--preview-red)" />
            <span className="h-1 w-1/4 rounded-full bg-(--preview-blue)" />
          </span>
        </div>
      </div>
    </div>
  );
}
