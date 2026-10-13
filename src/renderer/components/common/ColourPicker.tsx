import React, { useState } from 'react';

// ============================================================
// ColourPicker — Grid of preset colours + custom hex input
// ============================================================

const PRESET_COLOURS = [
  '#f7768e', // red
  '#ff9e64', // orange
  '#e0af68', // yellow
  '#9ece6a', // green
  '#73daca', // teal
  '#7dcfff', // sky
  '#7aa2f7', // blue
  '#bb9af7', // purple
  '#c0caf5', // lavender
  '#9d7cd8', // violet
  '#2ac3de', // cyan
  '#ff007c', // hot pink
  '#449dab', // dark teal
  '#565f89', // slate
  '#a9b1d6', // light grey
  '#1abc9c', // mint
];

export interface ColourPickerProps {
  value: string | null;
  onChange: (colour: string | null) => void;
}

export const ColourPicker: React.FC<ColourPickerProps> = ({ value, onChange }) => {
  const [customHex, setCustomHex] = useState(value ?? '');

  const handleCustomChange = (hex: string) => {
    setCustomHex(hex);
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      onChange(hex);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Preset grid */}
      <div className="grid grid-cols-8 gap-1.5">
        {PRESET_COLOURS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              onChange(c);
              setCustomHex(c);
            }}
            className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
            style={{
              backgroundColor: c,
              borderColor: value === c ? 'var(--color-text-primary)' : 'transparent',
            }}
            title={c}
          />
        ))}
      </div>

      {/* Custom hex + preview + clear */}
      <div className="flex items-center gap-2">
        {/* Preview swatch */}
        <div
          className="w-6 h-6 rounded border flex-shrink-0"
          style={{
            backgroundColor: value ?? 'transparent',
            borderColor: 'var(--color-border)',
          }}
        />

        <input
          type="text"
          className="input flex-1"
          placeholder="#000000"
          value={customHex}
          maxLength={7}
          onChange={(e) => handleCustomChange(e.target.value)}
        />

        <button
          type="button"
          className="btn btn-ghost text-[11px]"
          onClick={() => {
            onChange(null);
            setCustomHex('');
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
};
