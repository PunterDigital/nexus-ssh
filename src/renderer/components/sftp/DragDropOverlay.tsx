import React from 'react';
import { Download, Upload } from 'lucide-react';
import { Icon } from '../common/Icon';

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
        <Icon icon={side === 'remote' ? Upload : Download} size={32} strokeWidth={1.5} color="var(--color-accent)" />
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
