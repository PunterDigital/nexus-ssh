import React, { useRef, useState, useCallback } from 'react';
import { useTerminalStore } from '../../stores/terminal-store';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { Icon } from '../common/Icon';

// ============================================================
// TabBar — horizontal browser-style tab bar with drag-to-reorder
// ============================================================

interface TabBarProps {
  onNewTab: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({ onNewTab }) => {
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const setActiveTab = useTerminalStore((s) => s.setActiveTab);
  const removeTab = useTerminalStore((s) => s.removeTab);
  const reorderTabs = useTerminalStore((s) => s.reorderTabs);
  const disconnectSession = useTerminalStore((s) => s.disconnectSession);
  const sessions = useTerminalStore((s) => s.sessions);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [showScrollLeft, setShowScrollLeft] = useState(false);
  const [showScrollRight, setShowScrollRight] = useState(false);

  // Check scroll overflow
  const updateScrollIndicators = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setShowScrollLeft(el.scrollLeft > 0);
    setShowScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  const handleScroll = useCallback(() => {
    updateScrollIndicators();
  }, [updateScrollIndicators]);

  const scrollBy = useCallback((direction: 'left' | 'right') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === 'left' ? -160 : 160, behavior: 'smooth' });
  }, []);

  // Drag and drop handlers
  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      setDragIndex(index);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverIndex(index);
    },
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== toIndex) {
        reorderTabs(dragIndex, toIndex);
      }
      setDragIndex(null);
      setDragOverIndex(null);
    },
    [dragIndex, reorderTabs]
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  // Close tab, disconnect session if needed
  const handleCloseTab = useCallback(
    (e: React.MouseEvent, tabId: string, sessionId: string | null) => {
      e.stopPropagation();
      if (sessionId) {
        const session = sessions.find((s) => s.id === sessionId);
        if (session?.connected) {
          disconnectSession(sessionId).catch(() => {});
        }
      }
      removeTab(tabId);
    },
    [removeTab, disconnectSession, sessions]
  );

  // Middle-click to close
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, tabId: string, sessionId: string | null) => {
      if (e.button === 1) {
        e.preventDefault();
        handleCloseTab(e, tabId, sessionId);
      }
    },
    [handleCloseTab]
  );

  if (tabs.length === 0) {
    return (
      <div className="flex h-9 items-center border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2">
        <span className="text-xs text-[var(--color-text-muted)]">No open tabs</span>
        <div className="flex-1" />
        <button
          onClick={onNewTab}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
          title="New connection"
        >
          <Icon icon={Plus} size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-9 items-center border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      {/* Scroll left indicator */}
      {showScrollLeft && (
        <button
          onClick={() => scrollBy('left')}
          className="flex h-full w-6 flex-shrink-0 items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          <Icon icon={ChevronLeft} size={14} />
        </button>
      )}

      {/* Scrollable tab container */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex flex-1 items-center gap-0.5 overflow-x-auto px-1 scrollbar-none"
        style={{ scrollbarWidth: 'none' }}
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isDragging = dragIndex === index;
          const isDragOver = dragOverIndex === index && dragIndex !== index;
          const session = tab.sessionId
            ? sessions.find((s) => s.id === tab.sessionId)
            : null;
          const isDisconnected = session != null && !session.connected;

          return (
            <div
              key={tab.id}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              onClick={() => setActiveTab(tab.id)}
              onMouseDown={(e) => handleMouseDown(e, tab.id, tab.sessionId)}
              className={`group flex h-7 min-w-0 max-w-[180px] flex-shrink-0 cursor-pointer items-center gap-1.5 rounded px-2.5 text-xs transition-colors select-none ${
                isActive
                  ? 'bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]'
              } ${isDragging ? 'opacity-50' : ''} ${
                isDragOver ? 'border-l-2 border-[var(--color-accent)]' : ''
              }`}
            >
              {/* Colour indicator */}
              {tab.colour && (
                <span
                  className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: tab.colour }}
                />
              )}

              {/* Disconnected indicator */}
              {isDisconnected && !tab.colour && (
                <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-[var(--color-danger)]" />
              )}

              {/* Label */}
              <span
                className={`truncate ${isDisconnected ? 'line-through opacity-60' : ''}`}
              >
                {tab.label}
              </span>

              {/* Close button */}
              <button
                onClick={(e) => handleCloseTab(e, tab.id, tab.sessionId)}
                className="ml-auto flex h-4 w-4 flex-shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-[var(--color-bg-tertiary)] group-hover:opacity-100"
              >
                <Icon icon={X} size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Scroll right indicator */}
      {showScrollRight && (
        <button
          onClick={() => scrollBy('right')}
          className="flex h-full w-6 flex-shrink-0 items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          <Icon icon={ChevronRight} size={14} />
        </button>
      )}

      {/* New tab button */}
      <button
        onClick={onNewTab}
        className="mx-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
        title="New connection"
      >
        <Icon icon={Plus} size={14} />
      </button>
    </div>
  );
};
