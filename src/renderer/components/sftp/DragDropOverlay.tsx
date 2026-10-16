import React from 'react';
import { Download, Upload } from 'lucide-react';
import { Icon } from '../common/Icon';

// ============================================================
// DragDropOverlay — drop-zone feedback over a file pane while something droppable is dragged
// over it. Purely visual (the pane handles the drop), so it ignores the pointer and is hidden
// from screen readers.
// ============================================================

interface DragDropOverlayProps {
  side: 'local' | 'remote';
  visible: boolean;
}

export const DragDropOverlay: React.FC<DragDropOverlayProps> = ({ side, visible }) => {
  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent-soft animate-fade-in"
    >
      <div className="flex flex-col items-center gap-2 text-accent">
        <Icon icon={side === 'remote' ? Upload : Download} size={32} strokeWidth={1.5} />
        <span className="text-body font-medium">
          {side === 'remote' ? 'Drop to upload' : 'Drop to download'}
        </span>
      </div>
    </div>
  );
};
