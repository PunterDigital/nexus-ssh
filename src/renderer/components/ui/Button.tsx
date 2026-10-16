import type React from 'react';
import { LoaderCircle, type LucideIcon } from 'lucide-react';
import { Icon } from '../common/Icon';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ControlSize = 'sm' | 'md' | 'lg';

// Heights follow the control scale: sm 24 px (the WCAG 2.5.8 minimum target), md 32 px, lg 40 px.
const SIZE: Record<ControlSize, string> = {
  sm: 'h-6 gap-1.5 px-2 text-body-sm',
  md: 'h-8 gap-2 px-3 text-body',
  lg: 'h-10 gap-2 px-4 text-body-lg',
};

export const ICON_SIZE_FOR: Record<ControlSize, number> = { sm: 12, md: 14, lg: 16 };

export const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-110 active:brightness-95',
  secondary: 'border border-line-strong text-fg hover:bg-surface-hover active:bg-surface-pressed',
  ghost: 'text-fg-secondary hover:bg-surface-hover hover:text-fg active:bg-surface-pressed',
  danger: 'bg-danger text-on-danger hover:brightness-110 active:brightness-95',
};

export const CONTROL_BASE =
  'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-medium ' +
  'transition duration-(--duration-fast) ease-standard focus-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ControlSize;
  /** Lucide icon before the label. */
  icon?: LucideIcon;
  /** Lucide icon after the label (e.g. ChevronDown for a menu button). */
  iconRight?: LucideIcon;
  /** Shows a spinner in place of the icon, disables the button and sets aria-busy. */
  loading?: boolean;
  fullWidth?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

/** The one button. Primary = the main action of a view (at most one per view). */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  fullWidth = false,
  disabled,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  const iconSize = ICON_SIZE_FOR[size];
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(CONTROL_BASE, SIZE[size], VARIANT[variant], fullWidth && 'w-full', className)}
      {...rest}
    >
      {loading ? (
        <Icon icon={LoaderCircle} size={iconSize} className="animate-spin" />
      ) : (
        icon && <Icon icon={icon} size={iconSize} />
      )}
      {children}
      {iconRight && <Icon icon={iconRight} size={iconSize} />}
    </button>
  );
}
