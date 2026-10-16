import type React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../common/Icon';
import { cx } from './cx';
import { CONTROL_BASE, VARIANT, type ButtonVariant, type ControlSize } from './Button';

// Square: sm 24 px, md 32 px, lg 40 px.
const SIZE: Record<ControlSize, { box: string; icon: number }> = {
  sm: { box: 'size-6', icon: 14 },
  md: { box: 'size-8', icon: 16 },
  lg: { box: 'size-10', icon: 18 },
};

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  /** Accessible name, also shown as the tooltip. Required: the button has no visible text. */
  label: string;
  variant?: ButtonVariant;
  size?: ControlSize;
  /** For toggles (e.g. "show hidden files"): sets aria-pressed and the selected look. */
  pressed?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  pressed,
  type = 'button',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cx(
        CONTROL_BASE,
        SIZE[size].box,
        VARIANT[variant],
        pressed && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
        className,
      )}
      {...rest}
    >
      <Icon icon={icon} size={SIZE[size].icon} />
    </button>
  );
}
