import { useState } from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';

// ============================================================
// ColourPicker — preset swatches + a custom hex field (host tab colour, tag colour).
// The colours here are data saved on the host or tag, not theme colours.
// ============================================================

/* eslint-disable no-restricted-syntax -- preset colours a user can save on a host or tag (data) */
const PRESET_COLOURS: { value: string; name: string }[] = [
  { value: '#f7768e', name: 'Red' },
  { value: '#ff9e64', name: 'Orange' },
  { value: '#e0af68', name: 'Yellow' },
  { value: '#9ece6a', name: 'Green' },
  { value: '#73daca', name: 'Teal' },
  { value: '#7dcfff', name: 'Sky' },
  { value: '#7aa2f7', name: 'Blue' },
  { value: '#bb9af7', name: 'Purple' },
  { value: '#c0caf5', name: 'Lavender' },
  { value: '#9d7cd8', name: 'Violet' },
  { value: '#2ac3de', name: 'Cyan' },
  { value: '#ff007c', name: 'Hot pink' },
  { value: '#449dab', name: 'Dark teal' },
  { value: '#565f89', name: 'Slate' },
  { value: '#a9b1d6', name: 'Light grey' },
  { value: '#1abc9c', name: 'Mint' },
];
/* eslint-enable no-restricted-syntax */

const HEX = /^#[0-9a-fA-F]{6}$/;

export interface ColourPickerProps {
  value: string | null;
  onChange: (colour: string | null) => void;
}

export function ColourPicker({ value, onChange }: ColourPickerProps) {
  const [customHex, setCustomHex] = useState(value ?? '');

  const handleCustomChange = (hex: string) => {
    setCustomHex(hex);
    if (HEX.test(hex)) {
      onChange(hex);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Preset colours" className="grid w-fit grid-cols-8 gap-2">
        {PRESET_COLOURS.map((c) => {
          const selected = value?.toLowerCase() === c.value;
          return (
            <button
              key={c.value}
              type="button"
              aria-label={c.name}
              aria-pressed={selected}
              title={`${c.name} (${c.value})`}
              onClick={() => {
                onChange(c.value);
                setCustomHex(c.value);
              }}
              // eslint-disable-next-line no-restricted-syntax -- the swatch shows the colour itself (data)
              style={{ backgroundColor: c.value }}
              className={cx(
                'size-6 rounded-full focus-ring transition-transform duration-(--duration-fast) ease-standard hover:scale-110',
                selected && 'ring-2 ring-fg ring-offset-2 ring-offset-surface',
              )}
            />
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          // eslint-disable-next-line no-restricted-syntax -- preview of the chosen colour (data)
          style={value ? { backgroundColor: value } : undefined}
          className="size-8 shrink-0 rounded-md border border-line-strong"
        />
        <div className="w-32">
          <Input
            code
            aria-label="Custom colour (hex)"
            // eslint-disable-next-line no-restricted-syntax -- an example value, not a colour in use
            placeholder="#000000"
            value={customHex}
            maxLength={7}
            onChange={(e) => handleCustomChange(e.target.value)}
          />
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            onChange(null);
            setCustomHex('');
          }}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
