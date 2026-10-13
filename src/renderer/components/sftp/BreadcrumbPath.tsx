import React, { useState, useRef, useEffect, useCallback } from 'react';

// ============================================================
// BreadcrumbPath — clickable path segments with inline editing
// ============================================================

interface BreadcrumbPathProps {
  path: string;
  side: 'local' | 'remote';
  onNavigate: (path: string) => void;
}

/**
 * Split a path into navigable segments.
 * For Windows local paths like "C:\Users\foo", we keep the drive as the first segment.
 * For Unix paths like "/home/user/app", the root "/" is the first segment.
 */
function splitPath(path: string, side: 'local' | 'remote'): { label: string; path: string }[] {
  const segments: { label: string; path: string }[] = [];

  // Windows "This PC" drives-root sentinel
  if (path === '__drives__' && side === 'local') {
    return [{ label: 'This PC', path: '__drives__' }];
  }

  const normalized = path.replace(/\\/g, '/');

  // Windows drive root
  const driveMatch = normalized.match(/^([A-Za-z]:)\//);
  if (driveMatch && side === 'local') {
    segments.push({ label: 'This PC', path: '__drives__' });
    segments.push({ label: driveMatch[1], path: driveMatch[1] + '\\' });
    const rest = normalized.slice(driveMatch[0].length);
    if (rest) {
      const parts = rest.split('/').filter(Boolean);
      let accumulated = driveMatch[1] + '\\';
      for (const part of parts) {
        accumulated += part + '\\';
        segments.push({ label: part, path: accumulated });
      }
    }
    return segments;
  }

  // Unix path
  if (normalized.startsWith('/')) {
    segments.push({ label: '/', path: '/' });
    const parts = normalized.slice(1).split('/').filter(Boolean);
    let accumulated = '/';
    for (const part of parts) {
      accumulated += part + '/';
      segments.push({ label: part, path: accumulated });
    }
    return segments;
  }

  // Fallback
  segments.push({ label: normalized, path: normalized });
  return segments;
}

const MAX_VISIBLE_SEGMENTS = 6;

export const BreadcrumbPath: React.FC<BreadcrumbPathProps> = ({ path, side, onNavigate }) => {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(path);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInputValue(path);
  }, [path]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleSubmit = useCallback(() => {
    const trimmed = inputValue.trim();
    if (trimmed) {
      onNavigate(trimmed);
    }
    setEditing(false);
  }, [inputValue, onNavigate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSubmit();
      } else if (e.key === 'Escape') {
        setInputValue(path);
        setEditing(false);
      }
    },
    [handleSubmit, path],
  );

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="input h-7 text-xs font-mono flex-1"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleSubmit}
        spellCheck={false}
      />
    );
  }

  const segments = splitPath(path, side);
  const overflow = segments.length > MAX_VISIBLE_SEGMENTS;
  const visible = overflow
    ? [segments[0], { label: '\u2026', path: '' }, ...segments.slice(-(MAX_VISIBLE_SEGMENTS - 2))]
    : segments;

  return (
    <div
      className="flex items-center gap-0.5 flex-1 min-w-0 h-7 px-2 rounded cursor-text text-xs font-mono overflow-hidden"
      style={{ backgroundColor: 'var(--color-bg-tertiary)' }}
      onClick={() => setEditing(true)}
      title="Click to edit path"
    >
      {visible.map((seg, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <span className="mx-0.5 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
              /
            </span>
          )}
          {seg.path ? (
            <button
              className="hover:underline truncate flex-shrink-0 max-w-[120px]"
              style={{
                color:
                  i === visible.length - 1
                    ? 'var(--color-text-primary)'
                    : 'var(--color-text-secondary)',
                fontWeight: i === visible.length - 1 ? 600 : 400,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(seg.path);
              }}
              title={seg.path}
            >
              {seg.label}
            </button>
          ) : (
            <span style={{ color: 'var(--color-text-muted)' }}>{seg.label}</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};
