import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { IconButton } from './IconButton';
import { Input, type InputProps } from './Input';
import { cx } from './cx';

export type PasswordInputProps = Omit<InputProps, 'type' | 'leadingIcon'>;

/**
 * Password field with a show / hide toggle on the right. The toggle is a real button (keyboard
 * reachable, "Show password" / "Hide password", aria-pressed), so it works without a mouse.
 */
export function PasswordInput({ size = 'md', className, ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative w-full">
      <Input
        {...rest}
        size={size}
        type={visible ? 'text' : 'password'}
        autoComplete={rest.autoComplete ?? 'off'}
        spellCheck={false}
        className={cx(size === 'sm' ? 'pr-7' : 'pr-9', className)}
      />
      <IconButton
        icon={visible ? EyeOff : Eye}
        size="sm"
        label={visible ? 'Hide password' : 'Show password'}
        pressed={visible}
        disabled={rest.disabled}
        onClick={() => setVisible((v) => !v)}
        className={cx(
          'absolute top-1/2 -translate-y-1/2',
          size === 'sm' ? 'right-0' : 'right-1'
        )}
      />
    </div>
  );
}
