import React from 'react';

// ============================================================
// DragDropOverlay — visual drop zone feedback
// ============================================================

interface DragDropOverlayProps {
  side: 'local' | 'remote';
  visible: boolean;
}

export const DragDropOverlay: React.FC<DragDropOverlayProps> = ({ side, visible }) => {
  if (!visible) return null;

  const label = side === 'remote' ? 'Drop to upload' : 'Drop to download';

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center rounded-lg pointer-events-none"
      style={{
        backgroundColor: 'rgba(122, 162, 247, 0.08)',
        border: '2px dashed var(--color-accent)',
        animation: 'dropzone-pulse 1.5s ease-in-out infinite',
      }}
    >
      <div className="flex flex-col items-center gap-2">
        <svg
          className="w-8 h-8"
          style={{ color: 'var(--color-accent)' }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          {side === 'remote' ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12M12 16.5V3" />
          )}
        </svg>
        <span
          className="text-sm font-medium"
          style={{ color: 'var(--color-accent)' }}
        >
          {label}
        </span>
      </div>
      <style>{`
        @keyframes dropzone-pulse {
          0%, 100% { border-color: var(--color-accent); }
          50% { border-color: transparent; }
        }
      `}</style>
    </div>
  );
};
