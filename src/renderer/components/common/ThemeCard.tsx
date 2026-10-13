import React from 'react';
import type { NexusTheme } from '../../../shared/types';

// ============================================================
// ThemeCard — Small preview card for a theme
// ============================================================

export interface ThemeCardProps {
  theme: NexusTheme;
  selected: boolean;
  onClick: (theme: NexusTheme) => void;
}

export const ThemeCard: React.FC<ThemeCardProps> = ({ theme, selected, onClick }) => {
  const { ui, terminal } = theme;

  return (
    <button
      type="button"
      onClick={() => onClick(theme)}
      className="flex flex-col items-center gap-1.5 group focus-ring rounded-lg p-1.5 transition-all"
      style={{
        border: selected
          ? `2px solid var(--color-accent)`
          : '2px solid transparent',
        backgroundColor: selected ? 'var(--color-accent-muted)' : 'transparent',
      }}
      title={theme.name}
    >
      {/* Preview rectangle */}
      <div
        className="relative w-20 h-[60px] rounded overflow-hidden"
        style={{ backgroundColor: ui.bgPrimary }}
      >
        {/* Sidebar strip */}
        <div
          className="absolute left-0 top-0 bottom-0 w-5"
          style={{ backgroundColor: ui.bgSecondary }}
        >
          <div
            className="mt-2 ml-1 w-3 h-1 rounded-sm"
            style={{ backgroundColor: ui.textMuted }}
          />
          <div
            className="mt-1 ml-1 w-3 h-1 rounded-sm"
            style={{ backgroundColor: ui.accent }}
          />
          <div
            className="mt-1 ml-1 w-3 h-1 rounded-sm"
            style={{ backgroundColor: ui.textMuted }}
          />
        </div>

        {/* Terminal area */}
        <div
          className="absolute left-5 top-0 right-0 bottom-0 p-1.5"
          style={{ backgroundColor: terminal.background }}
        >
          <div className="flex flex-col gap-0.5">
            <div className="flex gap-1">
              <span className="text-[5px] font-mono" style={{ color: terminal.green }}>$</span>
              <span className="text-[5px] font-mono" style={{ color: terminal.foreground }}>ssh</span>
            </div>
            <div className="flex gap-1">
              <span className="text-[5px] font-mono" style={{ color: terminal.cyan }}>~</span>
              <span className="text-[5px] font-mono" style={{ color: terminal.yellow }}>ls</span>
            </div>
            <div className="flex gap-1">
              <span className="text-[5px] font-mono" style={{ color: terminal.red }}>err</span>
              <span className="text-[5px] font-mono" style={{ color: terminal.blue }}>ok</span>
            </div>
          </div>
        </div>

        {/* Accent bar at top */}
        <div
          className="absolute top-0 left-5 right-0 h-[3px]"
          style={{ backgroundColor: ui.accent }}
        />

        {/* Selected checkmark */}
        {selected && (
          <div
            className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 12 12"
              fill="none"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="2,6 5,9 10,3" />
            </svg>
          </div>
        )}
      </div>

      {/* Theme name */}
      <span
        className="text-[11px] font-medium truncate max-w-20"
        style={{
          color: selected ? 'var(--color-accent)' : 'var(--color-text-secondary)',
        }}
      >
        {theme.name}
      </span>
    </button>
  );
};
