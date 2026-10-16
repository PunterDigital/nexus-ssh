import { useCallback, useEffect } from 'react';
import {
  cachedTerminalPrefs,
  isTerminalPrefKey,
  readTerminalPref,
  readTerminalPrefs,
  setCachedTerminalPrefs,
} from '../lib/terminal-options';
import { useSettingsChanged } from './use-ipc';

/**
 * Keeps the terminal settings cache (lib/terminal-options) current while a vault is unlocked,
 * so a terminal opened at any time starts with the saved values, GPU acceleration included
 * (#2662). Terminals also listen themselves, to update while they are open.
 */
export function useTerminalPrefsCache(unlocked: boolean): void {
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    window.nexus.settings
      .getAll()
      .then((all: unknown) => {
        if (!cancelled) setCachedTerminalPrefs(readTerminalPrefs(all as Record<string, unknown>));
      })
      .catch(() => {
        // Locked again meanwhile
      });
    return () => {
      cancelled = true;
    };
  }, [unlocked]);

  const onChanged = useCallback((key: string, value: unknown) => {
    if (isTerminalPrefKey(key)) {
      setCachedTerminalPrefs({ ...cachedTerminalPrefs(), [key]: readTerminalPref(key, value) });
    }
  }, []);
  useSettingsChanged(onChanged);
}
