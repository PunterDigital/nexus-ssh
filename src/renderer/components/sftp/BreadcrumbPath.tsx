import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { IconButton, Input, cx } from '../ui';

// ============================================================
// BreadcrumbPath — the current folder as clickable segments; click the empty end of the bar,
// the "…" segment or the pencil button to type a path instead (Enter goes there, Escape
// cancels, leaving the field goes there too).
// ============================================================

interface BreadcrumbPathProps {
  path: string;
  side: 'local' | 'remote';
  onNavigate: (path: string) => void;
}

interface Segment {
  label: string;
  path: string;
}

/**
 * Split a path into navigable segments.
 * For Windows local paths like "C:\Users\foo", "This PC" and the drive come first.
 * For Unix paths like "/home/user/app", the root "/" is the first segment.
 */
export function splitPath(path: string, side: 'local' | 'remote'): Segment[] {
  // Windows "This PC" drives-root sentinel
  if (path === '__drives__' && side === 'local') {
    return [{ label: 'This PC', path: '__drives__' }];
  }

  const normalized = path.replace(/\\/g, '/');
  const segments: Segment[] = [];

  // Windows drive ("C:" or "C:/…")
  const driveMatch = normalized.match(/^([A-Za-z]:)(\/|$)/);
  if (driveMatch && side === 'local') {
    segments.push({ label: 'This PC', path: '__drives__' });
    segments.push({ label: driveMatch[1], path: driveMatch[1] + '\\' });
    let accumulated = driveMatch[1] + '\\';
    for (const part of normalized
      .slice(driveMatch[0].length)
      .split('/')
      .filter(Boolean)) {
      accumulated += part + '\\';
      segments.push({ label: part, path: accumulated });
    }
    return segments;
  }

  // Unix path
  if (normalized.startsWith('/')) {
    segments.push({ label: '/', path: '/' });
    let accumulated = '/';
    for (const part of normalized.slice(1).split('/').filter(Boolean)) {
      accumulated += part + '/';
      segments.push({ label: part, path: accumulated });
    }
    return segments;
  }

  return [{ label: normalized, path: normalized }];
}

const MAX_VISIBLE_SEGMENTS = 6;

export const BreadcrumbPath: React.FC<BreadcrumbPathProps> = ({
  path,
  side,
  onNavigate,
}) => {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(path);
  const inputRef = useRef<HTMLInputElement>(null);
  // Set once an edit is submitted or cancelled, so the blur that follows (the input unmounts)
  // doesn't navigate a second time or undo an Escape.
  const settled = useRef(false);
  const sideLabel = side === 'local' ? 'Local path' : 'Remote path';
  const navRef = useRef<HTMLElement>(null);

  // A path wider than the bar is clipped at the start, not the end: the current folder is the
  // part that matters. The nav is overflow-hidden, so scroll it to its end whenever it resizes.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const toEnd = () => {
      nav.scrollLeft = nav.scrollWidth;
    };
    toEnd();
    const observer = new ResizeObserver(toEnd);
    observer.observe(nav);
    if (nav.firstElementChild) observer.observe(nav.firstElementChild);
    return () => observer.disconnect();
  }, [path, editing]);

  useEffect(() => {
    setInputValue(path);
  }, [path]);

  useEffect(() => {
    if (editing && inputRef.current) {
      settled.current = false;
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = () => {
    setInputValue(path);
    setEditing(true);
  };

  const submit = () => {
    if (settled.current) return;
    settled.current = true;
    const trimmed = inputValue.trim();
    setEditing(false);
    if (trimmed) onNavigate(trimmed);
  };

  const cancel = () => {
    settled.current = true;
    setInputValue(path);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="min-w-32 flex-1">
        <Input
          ref={inputRef}
          size="sm"
          code
          aria-label={sideLabel}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              // Don't let Escape reach a dialog or menu handler further up.
              e.stopPropagation();
              cancel();
            }
          }}
          onBlur={submit}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    );
  }

  const segments = splitPath(path, side);
  const overflow = segments.length > MAX_VISIBLE_SEGMENTS;
  const visible: (Segment | null)[] = overflow
    ? [segments[0], null, ...segments.slice(-(MAX_VISIBLE_SEGMENTS - 2))]
    : segments;

  return (
    <div className="flex min-w-32 flex-1 items-center gap-1">
      <div
        className="flex h-6 min-w-0 flex-1 cursor-text items-center rounded-md border border-line-strong bg-surface-raised px-1 font-code text-body-sm"
        onClick={startEditing}
        title="Click to edit path"
      >
        <nav ref={navRef} aria-label={sideLabel} className="min-w-0 flex-1 overflow-hidden">
          <ol className="flex w-max items-center">
            {visible.map((seg, i) => {
              const last = i === visible.length - 1;
              return (
                <li
                  key={seg ? seg.path : 'overflow'}
                  className="flex shrink-0 items-center"
                >
                  {/* No separator after the root "/": it already is one */}
                  {i > 0 && visible[i - 1]?.label !== '/' && (
                    <span aria-hidden="true" className="px-0.5 text-fg-muted">
                      /
                    </span>
                  )}
                  {seg ? (
                    <button
                      type="button"
                      aria-current={last ? 'location' : undefined}
                      title={seg.path === '__drives__' ? 'This PC' : seg.path}
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigate(seg.path);
                      }}
                      className={cx(
                        'max-w-32 truncate rounded-sm px-1 hover:bg-surface-hover hover:text-fg focus-ring-inset',
                        last ? 'font-semibold text-fg' : 'text-fg-secondary'
                      )}
                    >
                      {seg.label}
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label="Show the full path"
                      title="Show the full path"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditing();
                      }}
                      className="rounded-sm px-1 text-fg-muted hover:bg-surface-hover hover:text-fg focus-ring-inset"
                    >
                      …
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
      <IconButton
        icon={Pencil}
        size="sm"
        label={side === 'local' ? 'Edit local path' : 'Edit remote path'}
        onClick={startEditing}
      />
    </div>
  );
};
