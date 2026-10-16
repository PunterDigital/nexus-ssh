import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Cloud,
  FolderOpen,
  FolderSync,
  Globe,
  Info,
  Palette,
  RefreshCw,
  SlidersHorizontal,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import type { NexusTheme } from '../../../shared/types';
import { BUNDLED_THEMES } from '../../styles/themes';
import { useUIStore } from '../../stores/ui-store';
import { useUpdateStore } from '../../stores/update-store';
import { Button, Card, Input, RadioGroup, Select, Switch, cx, type RadioOption } from '../ui';
import { NexusLogo } from '../vault/LockLayout';
import { ThemeCard } from './ThemeCard';
import { SyncSettingsView } from '../sync/SyncSettingsView';
import {
  DEFAULT_AUTO_LOCK_TIMEOUT,
  DEFAULT_CLIPBOARD_CLEAR_TIMEOUT,
  DEFAULT_FONT,
  DEFAULT_FONT_SIZE,
  DEFAULT_SCROLLBACK,
  DEFAULT_SFTP_CONCURRENCY,
  APP_NAME,
  DOWNLOADS_PAGE_URL,
  REPOSITORY_URL,
  UPDATE_CHECK_SETTING,
} from '../../../shared/constants';
import { Icon } from './Icon';

// ============================================================
// SettingsPanel — the Settings view: section navigation on the left, the section on the right
// (#2367). Every setting saves as soon as it changes.
// ============================================================

type SettingsSection = 'general' | 'appearance' | 'terminal' | 'sftp' | 'sync' | 'about';

const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon; description: string }[] = [
  {
    id: 'general',
    label: 'General',
    icon: SlidersHorizontal,
    description: 'Security timeouts, where vaults are stored, and updates.',
  },
  { id: 'appearance', label: 'Appearance', icon: Palette, description: 'Theme and interface size.' },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: SquareTerminal,
    description: 'How terminal sessions look and behave.',
  },
  { id: 'sftp', label: 'SFTP', icon: FolderSync, description: 'File browser and transfer defaults.' },
  {
    id: 'sync',
    label: 'Vault Sync',
    icon: Cloud,
    description:
      'Sync your encrypted vault file to a remote backend (SFTP, S3, or a local folder watched by ' +
      'Dropbox / OneDrive / etc). The vault file is already encrypted — the backend only ever sees ' +
      'an opaque blob.',
  },
  { id: 'about', label: 'About', icon: Info, description: 'Version, links and updates.' },
];

const TERMINAL_FONTS = ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'monospace'].map(
  (f) => ({ value: f, label: f }),
);

type CursorStyle = 'block' | 'underline' | 'bar';

const CURSOR_STYLES: RadioOption<CursorStyle>[] = [
  { value: 'block', label: 'Block' },
  { value: 'underline', label: 'Underline' },
  { value: 'bar', label: 'Bar' },
];

interface SettingsValues {
  autoLockTimeout: number;
  clipboardClearTimeout: number;
  defaultVaultPath: string;
  terminalFont: string;
  terminalFontSize: number;
  scrollbackLines: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  gpuAcceleration: boolean;
  sftpConcurrency: number;
  showHiddenFiles: boolean;
  uiFontSize: number;
  checkForUpdates: boolean;
}

const DEFAULT_SETTINGS: SettingsValues = {
  autoLockTimeout: DEFAULT_AUTO_LOCK_TIMEOUT,
  clipboardClearTimeout: DEFAULT_CLIPBOARD_CLEAR_TIMEOUT,
  defaultVaultPath: '',
  terminalFont: DEFAULT_FONT,
  terminalFontSize: DEFAULT_FONT_SIZE,
  scrollbackLines: DEFAULT_SCROLLBACK,
  cursorStyle: 'block',
  cursorBlink: true,
  gpuAcceleration: true,
  sftpConcurrency: DEFAULT_SFTP_CONCURRENCY,
  showHiddenFiles: false,
  uiFontSize: 16,
  checkForUpdates: true,
};

// Keys that live in app-level (unencrypted, cross-vault) settings; the rest are saved in the vault.
const APP_LEVEL_KEYS: Array<keyof SettingsValues> = ['uiFontSize', UPDATE_CHECK_SETTING];

/** Apply the UI font size to the document root so Tailwind rem values scale. */
function applyUIFontSize(size: number): void {
  document.documentElement.style.fontSize = `${size}px`;
}

/** Clamp a number input's text to [min, max], or `fallback` when it isn't a number. */
function clampInt(text: string, min: number, max: number, fallback: number): number {
  return Math.min(max, Math.max(min, parseInt(text) || fallback));
}

export const SettingsPanel: React.FC = () => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [settings, setSettings] = useState<SettingsValues>(DEFAULT_SETTINGS);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const addNotification = useUIStore((s) => s.addNotification);

  // Load settings on mount
  useEffect(() => {
    (async () => {
      try {
        const [vaultSettings, appSettings] = await Promise.all([
          (window.nexus.settings.getAll() as Promise<Partial<SettingsValues>>).catch(() => null),
          window.nexus.appSettings.getAll().catch(() => null),
        ]);
        const { cursorStyle, cursorBlink } = vaultSettings ?? {};

        setSettings((prev) => ({
          ...prev,
          autoLockTimeout: vaultSettings?.autoLockTimeout ?? prev.autoLockTimeout,
          clipboardClearTimeout: vaultSettings?.clipboardClearTimeout ?? prev.clipboardClearTimeout,
          defaultVaultPath: vaultSettings?.defaultVaultPath ?? prev.defaultVaultPath,
          terminalFont: vaultSettings?.terminalFont ?? prev.terminalFont,
          terminalFontSize: vaultSettings?.terminalFontSize ?? prev.terminalFontSize,
          scrollbackLines: vaultSettings?.scrollbackLines ?? prev.scrollbackLines,
          cursorStyle: CURSOR_STYLES.some((c) => c.value === cursorStyle)
            ? (cursorStyle as CursorStyle)
            : prev.cursorStyle,
          cursorBlink: typeof cursorBlink === 'boolean' ? cursorBlink : prev.cursorBlink,
          gpuAcceleration: vaultSettings?.gpuAcceleration ?? prev.gpuAcceleration,
          sftpConcurrency: vaultSettings?.sftpConcurrency ?? prev.sftpConcurrency,
          showHiddenFiles: vaultSettings?.showHiddenFiles ?? prev.showHiddenFiles,
          // UI-only preference lives in app-level settings
          uiFontSize: (appSettings?.uiFontSize as number | undefined) ?? prev.uiFontSize,
          checkForUpdates: appSettings?.[UPDATE_CHECK_SETTING] !== false,
        }));

        if (typeof appSettings?.uiFontSize === 'number') {
          applyUIFontSize(appSettings.uiFontSize);
        }
      } catch {
        // Settings may not be available yet; use defaults
      }
    })();
  }, []);

  const updateSetting = useCallback(
    async <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));

      // Apply side-effects immediately where relevant
      if (key === 'uiFontSize' && typeof value === 'number') {
        applyUIFontSize(value);
      }

      try {
        if (APP_LEVEL_KEYS.includes(key)) {
          await window.nexus.appSettings.set(key, value);
        } else {
          await window.nexus.settings.set(key, value);
        }
      } catch (err) {
        addNotification('error', `Failed to save setting: ${(err as Error).message}`);
      }
    },
    [addNotification],
  );

  const handleThemeSelect = useCallback(
    (t: NexusTheme) => {
      setTheme(t);
      window.nexus.settings.set('theme', t.id).catch(() => {});
    },
    [setTheme],
  );

  const [checking, setChecking] = useState(false);
  const checkNow = useUpdateStore((s) => s.checkNow);
  const handleCheckForUpdates = useCallback(async () => {
    setChecking(true);
    try {
      const status = await checkNow();
      switch (status.state) {
        case 'up-to-date':
          addNotification('info', `You're running the latest version (v${__APP_VERSION__}).`);
          break;
        case 'available':
          // notify mode shows the update card; install mode downloads first.
          if (status.mode === 'install') {
            addNotification('info', `Downloading Nexus v${status.version}…`);
          }
          break;
        case 'downloaded':
          break; // the update card offers "Restart to update"
        case 'error':
          addNotification('error', `Couldn't check for updates: ${status.message}`);
          break;
        default:
          addNotification('info', 'Update checks only run in the installed app.');
      }
    } catch (err) {
      addNotification('error', `Couldn't check for updates: ${(err as Error).message}`);
    } finally {
      setChecking(false);
    }
  }, [checkNow, addNotification]);

  const handleBrowseVaultDir = useCallback(async () => {
    try {
      const chosen = await window.nexus.fs.pickDirectory();
      if (!chosen) return;
      await window.nexus.settings.set('defaultVaultPath', chosen);
      setSettings((prev) => ({ ...prev, defaultVaultPath: chosen }));
      addNotification('success', `Vault directory set to ${chosen}`);
    } catch (err) {
      addNotification('error', (err as Error).message);
    }
  }, [addNotification]);

  const openLink = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, url: string) => {
      e.preventDefault();
      window.nexus.shell.openExternal(url).catch((err: unknown) => {
        addNotification('error', `Couldn't open the link: ${(err as Error).message}`);
      });
    },
    [addNotification],
  );

  const section = SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0];
  const titleId = useId();

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 bg-surface">
      {/* Section navigation */}
      <div className="flex w-40 shrink-0 flex-col gap-2 border-r border-line p-2">
        <h2 className="truncate px-2 pt-1 text-heading-sm font-semibold text-fg">Settings</h2>
        <nav aria-label="Settings sections" className="flex flex-col gap-0.5">
          {SECTIONS.map((s) => {
            const active = s.id === activeSection;
            return (
              <button
                key={s.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => setActiveSection(s.id)}
                className={cx(
                  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-body font-medium',
                  'transition-colors duration-(--duration-fast) ease-standard focus-ring-inset',
                  active
                    ? 'bg-accent-soft text-accent'
                    : 'text-fg-secondary hover:bg-surface-hover hover:text-fg',
                )}
              >
                <Icon icon={s.icon} size={16} />
                <span className="truncate">{s.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* The selected section */}
      <div className="min-w-0 flex-1 overflow-y-auto scrollbar-thin">
        <section
          aria-labelledby={titleId}
          className="@container mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6"
        >
          <div className="flex flex-col gap-1">
            <h3 id={titleId} className="text-heading font-semibold text-fg">
              {section.label}
            </h3>
            <p className="text-body text-fg-muted">{section.description}</p>
          </div>

          {activeSection === 'general' && (
            <>
              <SettingsGroup title="Security">
                <SettingRow
                  label="Auto-lock timeout"
                  description="Lock the vault after this much inactivity. 0 turns it off."
                >
                  {(ids) => (
                    <NumberInput
                      ids={ids}
                      unit="min"
                      min={0}
                      value={settings.autoLockTimeout}
                      onChange={(text) => updateSetting('autoLockTimeout', Math.max(0, parseInt(text) || 0))}
                    />
                  )}
                </SettingRow>
                <SettingRow
                  label="Clipboard clear timeout"
                  description="Clear copied passwords from the clipboard after this long. 0 turns it off."
                >
                  {(ids) => (
                    <NumberInput
                      ids={ids}
                      unit="sec"
                      min={0}
                      value={settings.clipboardClearTimeout}
                      onChange={(text) =>
                        updateSetting('clipboardClearTimeout', Math.max(0, parseInt(text) || 0))
                      }
                    />
                  )}
                </SettingRow>
              </SettingsGroup>

              <SettingsGroup title="Storage">
                <SettingRow
                  label="Default vault directory"
                  description={
                    <>
                      Where vault database files are stored. Changing it only affects new vaults: move
                      existing .db files yourself if needed.
                      <span
                        className="mt-1 block truncate font-code text-body-sm text-fg-secondary"
                        title={settings.defaultVaultPath || 'Default'}
                      >
                        {settings.defaultVaultPath || 'Default'}
                      </span>
                    </>
                  }
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={FolderOpen}
                    title="Open in file explorer"
                    onClick={() => {
                      window.nexus.fs.openVaultDir().catch(() => {});
                    }}
                  >
                    Open
                  </Button>
                  <Button size="sm" title="Choose a different directory" onClick={handleBrowseVaultDir}>
                    Change…
                  </Button>
                </SettingRow>
              </SettingsGroup>

              <SettingsGroup title="Updates">
                <SettingRow
                  label="Check for updates automatically"
                  description="Look for a new version at launch and every few hours. On Windows it downloads in the background and asks before restarting; on macOS it links to the downloads page."
                >
                  {(ids) => (
                    <Switch
                      id={ids.id}
                      aria-describedby={ids.describedBy}
                      checked={settings.checkForUpdates}
                      onChange={(v) => updateSetting('checkForUpdates', v)}
                    />
                  )}
                </SettingRow>
              </SettingsGroup>
            </>
          )}

          {activeSection === 'appearance' && (
            <>
              <ThemePicker value={theme.id} onSelect={handleThemeSelect} />
              <SettingsGroup title="Interface">
                <SettingRow label="UI font size" description="Base size for the app's text (10–20 px).">
                  {(ids) => (
                    <NumberInput
                      ids={ids}
                      unit="px"
                      min={10}
                      max={20}
                      value={settings.uiFontSize}
                      onChange={(text) => updateSetting('uiFontSize', clampInt(text, 10, 20, 13))}
                    />
                  )}
                </SettingRow>
              </SettingsGroup>
            </>
          )}

          {activeSection === 'terminal' && (
            <>
              <SettingsGroup title="Text">
                <SettingRow label="Font family">
                  {(ids) => (
                    <div className="w-48">
                      <Select
                        id={ids.id}
                        options={TERMINAL_FONTS}
                        value={settings.terminalFont}
                        onChange={(e) => updateSetting('terminalFont', e.target.value)}
                      />
                    </div>
                  )}
                </SettingRow>
                <SettingRow label="Font size" description="Terminal text size in pixels (8–32).">
                  {(ids) => (
                    <NumberInput
                      ids={ids}
                      unit="px"
                      min={8}
                      max={32}
                      value={settings.terminalFontSize}
                      onChange={(text) =>
                        updateSetting('terminalFontSize', clampInt(text, 8, 32, DEFAULT_FONT_SIZE))
                      }
                    />
                  )}
                </SettingRow>
                <SettingRow label="Scrollback lines" description="Lines kept in history (1,000–100,000).">
                  {(ids) => (
                    <NumberInput
                      ids={ids}
                      wide
                      min={1000}
                      max={100000}
                      step={1000}
                      value={settings.scrollbackLines}
                      onChange={(text) =>
                        updateSetting('scrollbackLines', clampInt(text, 1000, 100000, DEFAULT_SCROLLBACK))
                      }
                    />
                  )}
                </SettingRow>
              </SettingsGroup>

              <SettingsGroup title="Cursor">
                <SettingRow label="Cursor style">
                  <RadioGroup
                    label="Cursor style"
                    options={CURSOR_STYLES}
                    value={settings.cursorStyle}
                    onChange={(v) => updateSetting('cursorStyle', v)}
                  />
                </SettingRow>
                <SettingRow label="Cursor blink" description="Blink the cursor in terminal sessions.">
                  {(ids) => (
                    <Switch
                      id={ids.id}
                      aria-describedby={ids.describedBy}
                      checked={settings.cursorBlink}
                      onChange={(v) => updateSetting('cursorBlink', v)}
                    />
                  )}
                </SettingRow>
              </SettingsGroup>

              <SettingsGroup title="Rendering">
                <SettingRow
                  label="GPU acceleration"
                  description="Draw terminals with WebGL for better performance. Applies to sessions opened after the change."
                >
                  {(ids) => (
                    <Switch
                      id={ids.id}
                      aria-describedby={ids.describedBy}
                      checked={settings.gpuAcceleration}
                      onChange={(v) => updateSetting('gpuAcceleration', v)}
                    />
                  )}
                </SettingRow>
              </SettingsGroup>
            </>
          )}

          {activeSection === 'sftp' && (
            <SettingsGroup>
              <SettingRow
                label="Default concurrent transfers"
                description="Files transferred at the same time (1–10)."
              >
                {(ids) => (
                  <NumberInput
                    ids={ids}
                    min={1}
                    max={10}
                    value={settings.sftpConcurrency}
                    onChange={(text) =>
                      updateSetting('sftpConcurrency', clampInt(text, 1, 10, DEFAULT_SFTP_CONCURRENCY))
                    }
                  />
                )}
              </SettingRow>
              <SettingRow
                label="Show hidden files by default"
                description="Show dotfiles and hidden files in the file browser."
              >
                {(ids) => (
                  <Switch
                    id={ids.id}
                    aria-describedby={ids.describedBy}
                    checked={settings.showHiddenFiles}
                    onChange={(v) => updateSetting('showHiddenFiles', v)}
                  />
                )}
              </SettingRow>
            </SettingsGroup>
          )}

          {activeSection === 'sync' && <SyncSettingsView />}

          {activeSection === 'about' && (
            <Card padding="lg" as="div" className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <NexusLogo />
                <div className="min-w-0">
                  <p className="text-body-lg font-semibold text-fg">
                    {APP_NAME} v{__APP_VERSION__}
                  </p>
                  <p className="text-body-sm text-fg-muted">Punter Digital Limited</p>
                </div>
              </div>

              <p className="text-body text-fg-secondary">
                A modern, encrypted SSH client with vault-based credential management, multi-session
                terminals, SFTP file browser, and cross-device sync.
              </p>

              {/* Opened in the default browser by main (allow-listed); the window never navigates. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <a
                  href={REPOSITORY_URL}
                  onClick={(e) => openLink(e, REPOSITORY_URL)}
                  className="inline-flex items-center gap-1.5 rounded-sm text-body text-accent hover:underline focus-ring"
                >
                  <svg data-logo aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                  GitHub Repository
                </a>
                <a
                  href={DOWNLOADS_PAGE_URL}
                  onClick={(e) => openLink(e, DOWNLOADS_PAGE_URL)}
                  className="inline-flex items-center gap-1.5 rounded-sm text-body text-accent hover:underline focus-ring"
                >
                  <Icon icon={Globe} size={14} />
                  Website
                </a>
              </div>

              <div className="border-t border-line pt-4">
                <Button icon={RefreshCw} loading={checking} onClick={handleCheckForUpdates}>
                  {checking ? 'Checking…' : 'Check for Updates'}
                </Button>
              </div>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
};

// ── Building blocks ──────────────────────────────────────────

interface ControlIds {
  /** Give the control this id: the row's label points at it. */
  id: string;
  /** The row's description, for the control's aria-describedby. */
  describedBy?: string;
}

/** A titled group of setting rows in a card. */
function SettingsGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={title ? id : undefined} className="flex flex-col gap-2">
      {title && (
        <h4 id={id} className="text-body-sm font-semibold text-fg-secondary">
          {title}
        </h4>
      )}
      <Card as="div" padding="none" className="divide-y divide-line">
        {children}
      </Card>
    </section>
  );
}

/**
 * One setting: label and description on the left, the control on the right (stacked below when
 * the section is narrow). Pass a function as children to get the ids that label the control;
 * controls that name themselves (a RadioGroup, buttons) are passed as plain children.
 */
function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode | ((ids: ControlIds) => React.ReactNode);
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const labelled = typeof children === 'function';
  const labelClass = 'block text-body font-medium text-fg';
  return (
    <div className="flex flex-col gap-2 px-4 py-3 @md:flex-row @md:items-center @md:justify-between @md:gap-6">
      <div className="min-w-0 flex-1">
        {labelled ? (
          <label htmlFor={id} className={labelClass}>
            {label}
          </label>
        ) : (
          <span className={labelClass}>{label}</span>
        )}
        {description && (
          <div id={descriptionId} className="mt-0.5 text-body-sm text-fg-muted">
            {description}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {labelled ? children({ id, describedBy: description ? descriptionId : undefined }) : children}
      </div>
    </div>
  );
}

/** A number field with an optional unit after it (the unit is read out with the description). */
function NumberInput({
  ids,
  unit,
  wide = false,
  value,
  onChange,
  ...limits
}: {
  ids: ControlIds;
  unit?: string;
  /** Room for six digits (scrollback). */
  wide?: boolean;
  value: number;
  onChange: (text: string) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const unitId = `${ids.id}-unit`;
  const describedBy = [ids.describedBy, unit && unitId].filter(Boolean).join(' ') || undefined;
  return (
    <>
      <div className={wide ? 'w-28' : 'w-20'}>
        <Input
          type="number"
          id={ids.id}
          aria-describedby={describedBy}
          className="text-right"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...limits}
        />
      </div>
      {unit && (
        <span id={unitId} className="text-body-sm text-fg-muted">
          {unit}
        </span>
      )}
    </>
  );
}

/**
 * The bundled themes as a radio group of preview cards (APG radio group: one tab stop, the arrow
 * keys / Home / End move the selection, which applies the theme at once).
 */
function ThemePicker({ value, onSelect }: { value: string; onSelect: (theme: NexusTheme) => void }) {
  const labelId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const selectedIndex = BUNDLED_THEMES.findIndex((t) => t.id === value);
  // The tab stop: the selected theme, or the first one if the current theme isn't bundled.
  const focusIndex = Math.max(0, selectedIndex);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = BUNDLED_THEMES.length;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (focusIndex + 1) % n
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (focusIndex - 1 + n) % n
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    const theme = BUNDLED_THEMES[next];
    onSelect(theme);
    listRef.current?.querySelector<HTMLElement>(`[data-theme-id="${theme.id}"]`)?.focus();
  };

  return (
    <section className="flex flex-col gap-2">
      <h4 id={labelId} className="text-body-sm font-semibold text-fg-secondary">
        Theme
      </h4>
      <div
        ref={listRef}
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={onKeyDown}
        className="grid grid-cols-2 gap-2 @md:grid-cols-3 @xl:grid-cols-4"
      >
        {BUNDLED_THEMES.map((t, i) => (
          <ThemeCard
            key={t.id}
            data-theme-id={t.id}
            theme={t}
            selected={i === selectedIndex}
            tabIndex={i === focusIndex ? 0 : -1}
            onClick={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
