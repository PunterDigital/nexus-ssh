import React, { useState, useEffect, useCallback } from 'react';
import type { NexusTheme } from '../../../shared/types';
import { BUNDLED_THEMES } from '../../styles/themes';
import { useUIStore } from '../../stores/ui-store';
import { FormField } from './FormField';
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
} from '../../../shared/constants';

// ============================================================
// SettingsPanel — Full settings panel with sections
// ============================================================

type SettingsSection = 'general' | 'appearance' | 'terminal' | 'sftp' | 'sync' | 'about';

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'sftp', label: 'SFTP' },
  { id: 'sync', label: 'Vault Sync' },
  { id: 'about', label: 'About' },
];

const TERMINAL_FONTS = [
  'JetBrains Mono',
  'Fira Code',
  'Cascadia Code',
  'Consolas',
  'monospace',
];

const CURSOR_STYLES = [
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
  cursorStyle: string;
  cursorBlink: boolean;
  gpuAcceleration: boolean;
  sftpConcurrency: number;
  showHiddenFiles: boolean;
  uiFontSize: number;
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
};

/** Apply the UI font size to the document root so Tailwind rem values scale. */
function applyUIFontSize(size: number): void {
  document.documentElement.style.fontSize = `${size}px`;
}

// Toggle switch component
const Toggle: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}> = ({ checked, onChange, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
    style={{
      backgroundColor: checked ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
      opacity: disabled ? 0.5 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
    }}
  >
    <span
      className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
      style={{
        left: '2px',
        transform: checked ? 'translateX(16px)' : 'translateX(0)',
      }}
    />
  </button>
);

// Setting row with label, description, and control
const SettingRow: React.FC<{
  label: string;
  description?: string;
  children: React.ReactNode;
}> = ({ label, description, children }) => (
  <div className="flex items-center justify-between gap-4 py-2.5">
    <div className="flex-1 min-w-0">
      <span className="text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>
        {label}
      </span>
      {description && (
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          {description}
        </p>
      )}
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
);

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

        setSettings((prev) => ({
          ...prev,
          autoLockTimeout: vaultSettings?.autoLockTimeout ?? prev.autoLockTimeout,
          clipboardClearTimeout: vaultSettings?.clipboardClearTimeout ?? prev.clipboardClearTimeout,
          defaultVaultPath: vaultSettings?.defaultVaultPath ?? prev.defaultVaultPath,
          terminalFont: vaultSettings?.terminalFont ?? prev.terminalFont,
          terminalFontSize: vaultSettings?.terminalFontSize ?? prev.terminalFontSize,
          scrollbackLines: vaultSettings?.scrollbackLines ?? prev.scrollbackLines,
          gpuAcceleration: vaultSettings?.gpuAcceleration ?? prev.gpuAcceleration,
          sftpConcurrency: vaultSettings?.sftpConcurrency ?? prev.sftpConcurrency,
          showHiddenFiles: vaultSettings?.showHiddenFiles ?? prev.showHiddenFiles,
          // UI-only preference lives in app-level settings
          uiFontSize:
            (appSettings?.uiFontSize as number | undefined) ?? prev.uiFontSize,
        }));

        if (typeof appSettings?.uiFontSize === 'number') {
          applyUIFontSize(appSettings.uiFontSize);
        }
      } catch {
        // Settings may not be available yet; use defaults
      }
    })();
  }, []);

  // Keys that live in app-level (unencrypted, cross-vault) settings
  const APP_LEVEL_KEYS: Array<keyof SettingsValues> = ['uiFontSize'];

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

  return (
    <div className="flex h-full" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      {/* Section navigation */}
      <div
        className="flex flex-col w-44 flex-shrink-0 border-r py-3"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-bg-secondary)',
        }}
      >
        <h2
          className="text-sm font-semibold px-4 mb-3"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Settings
        </h2>
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className="text-left px-4 py-1.5 text-xs transition-colors"
            style={{
              color:
                activeSection === section.id
                  ? 'var(--color-accent)'
                  : 'var(--color-text-secondary)',
              backgroundColor:
                activeSection === section.id
                  ? 'var(--color-accent-muted)'
                  : 'transparent',
            }}
            onClick={() => setActiveSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </div>

      {/* Settings content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4">
        {/* General */}
        {activeSection === 'general' && (
          <div className="flex flex-col gap-1 max-w-xl">
            <SectionHeader title="General" />

            <SettingRow
              label="Auto-lock timeout"
              description="Lock the vault after inactivity. Set to 0 to disable."
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  className="input w-20 text-right text-xs"
                  min={0}
                  value={settings.autoLockTimeout}
                  onChange={(e) =>
                    updateSetting('autoLockTimeout', Math.max(0, parseInt(e.target.value) || 0))
                  }
                />
                <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  min
                </span>
              </div>
            </SettingRow>

            <SettingRow
              label="Clipboard clear timeout"
              description="Automatically clear copied passwords from clipboard. Set to 0 to disable."
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  className="input w-20 text-right text-xs"
                  min={0}
                  value={settings.clipboardClearTimeout}
                  onChange={(e) =>
                    updateSetting(
                      'clipboardClearTimeout',
                      Math.max(0, parseInt(e.target.value) || 0),
                    )
                  }
                />
                <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  sec
                </span>
              </div>
            </SettingRow>

            <SettingRow
              label="Default vault directory"
              description="Where vault database files are stored. Changing this only affects NEW vaults — move existing .db files yourself if needed."
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="text-[11px] font-mono truncate max-w-56"
                  style={{ color: 'var(--color-text-muted)' }}
                  title={settings.defaultVaultPath || 'Default'}
                >
                  {settings.defaultVaultPath || 'Default'}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost text-[11px] py-1 px-2"
                  onClick={() => {
                    window.nexus.fs.openVaultDir().catch(() => {});
                  }}
                  title="Open in file explorer"
                >
                  Open
                </button>
                <button
                  type="button"
                  className="btn btn-ghost text-[11px] py-1 px-2"
                  onClick={handleBrowseVaultDir}
                  title="Choose a different directory"
                >
                  Change...
                </button>
              </div>
            </SettingRow>
          </div>
        )}

        {/* Appearance */}
        {activeSection === 'appearance' && (
          <div className="flex flex-col gap-4 max-w-xl">
            <SectionHeader title="Appearance" />

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                Theme
              </span>
              <div className="grid grid-cols-4 gap-2">
                {BUNDLED_THEMES.map((t) => (
                  <ThemeCard
                    key={t.id}
                    theme={t}
                    selected={theme.id === t.id}
                    onClick={handleThemeSelect}
                  />
                ))}
              </div>
            </div>

            <SettingRow
              label="UI font size"
              description="Base font size for the application interface."
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  className="input w-16 text-right text-xs"
                  min={10}
                  max={20}
                  value={settings.uiFontSize}
                  onChange={(e) => {
                    const val = Math.min(20, Math.max(10, parseInt(e.target.value) || 13));
                    updateSetting('uiFontSize', val);
                  }}
                />
                <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  px
                </span>
              </div>
            </SettingRow>
          </div>
        )}

        {/* Terminal */}
        {activeSection === 'terminal' && (
          <div className="flex flex-col gap-1 max-w-xl">
            <SectionHeader title="Terminal" />

            <SettingRow label="Font family">
              <select
                className="input w-44 text-xs"
                value={settings.terminalFont}
                onChange={(e) => updateSetting('terminalFont', e.target.value)}
              >
                {TERMINAL_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </SettingRow>

            <SettingRow label="Font size" description="Terminal font size in pixels (8-32).">
              <input
                type="number"
                className="input w-20 text-right text-xs"
                min={8}
                max={32}
                value={settings.terminalFontSize}
                onChange={(e) => {
                  const val = Math.min(32, Math.max(8, parseInt(e.target.value) || DEFAULT_FONT_SIZE));
                  updateSetting('terminalFontSize', val);
                }}
              />
            </SettingRow>

            <SettingRow label="Scrollback lines" description="Number of lines kept in history (1,000 - 100,000).">
              <input
                type="number"
                className="input w-24 text-right text-xs"
                min={1000}
                max={100000}
                step={1000}
                value={settings.scrollbackLines}
                onChange={(e) => {
                  const val = Math.min(100000, Math.max(1000, parseInt(e.target.value) || DEFAULT_SCROLLBACK));
                  updateSetting('scrollbackLines', val);
                }}
              />
            </SettingRow>

            <SettingRow label="Cursor style">
              <div className="flex items-center gap-2">
                {CURSOR_STYLES.map((cs) => (
                  <label
                    key={cs.value}
                    className="flex items-center gap-1 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="cursorStyle"
                      value={cs.value}
                      checked={settings.cursorStyle === cs.value}
                      onChange={() => updateSetting('cursorStyle', cs.value)}
                      className="sr-only"
                    />
                    <span
                      className="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center"
                      style={{
                        borderColor:
                          settings.cursorStyle === cs.value
                            ? 'var(--color-accent)'
                            : 'var(--color-border)',
                      }}
                    >
                      {settings.cursorStyle === cs.value && (
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: 'var(--color-accent)' }}
                        />
                      )}
                    </span>
                    <span
                      className="text-[11px]"
                      style={{
                        color:
                          settings.cursorStyle === cs.value
                            ? 'var(--color-text-primary)'
                            : 'var(--color-text-muted)',
                      }}
                    >
                      {cs.label}
                    </span>
                  </label>
                ))}
              </div>
            </SettingRow>

            <SettingRow label="Cursor blink" description="Enable blinking cursor in terminal.">
              <Toggle
                checked={settings.cursorBlink}
                onChange={(v) => updateSetting('cursorBlink', v)}
              />
            </SettingRow>

            <SettingRow
              label="GPU acceleration"
              description="Use WebGL renderer for better performance."
            >
              <Toggle
                checked={settings.gpuAcceleration}
                onChange={(v) => updateSetting('gpuAcceleration', v)}
              />
            </SettingRow>
          </div>
        )}

        {/* SFTP */}
        {activeSection === 'sftp' && (
          <div className="flex flex-col gap-1 max-w-xl">
            <SectionHeader title="SFTP" />

            <SettingRow
              label="Default concurrent transfers"
              description="Number of simultaneous file transfers (1-10)."
            >
              <input
                type="number"
                className="input w-20 text-right text-xs"
                min={1}
                max={10}
                value={settings.sftpConcurrency}
                onChange={(e) => {
                  const val = Math.min(10, Math.max(1, parseInt(e.target.value) || DEFAULT_SFTP_CONCURRENCY));
                  updateSetting('sftpConcurrency', val);
                }}
              />
            </SettingRow>

            <SettingRow
              label="Show hidden files by default"
              description="Display dotfiles and hidden files in the file browser."
            >
              <Toggle
                checked={settings.showHiddenFiles}
                onChange={(v) => updateSetting('showHiddenFiles', v)}
              />
            </SettingRow>
          </div>
        )}

        {/* Vault Sync */}
        {activeSection === 'sync' && (
          <div className="flex flex-col gap-4">
            <SectionHeader title="Vault Sync" />
            <p className="text-xs text-[var(--color-text-muted)]">
              Sync your encrypted vault file to a remote backend (SFTP, S3,
              or a local folder watched by Dropbox / OneDrive / etc). The
              vault file is already encrypted — the backend only ever sees
              an opaque blob.
            </p>
            <SyncSettingsView />
          </div>
        )}

        {/* About */}
        {activeSection === 'about' && (
          <div className="flex flex-col gap-4 max-w-xl">
            <SectionHeader title="About" />

            <div className="flex flex-col gap-3">
              {/* App identity */}
              <div
                className="flex items-center gap-4 p-4 rounded-lg"
                style={{
                  backgroundColor: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg"
                  style={{
                    backgroundColor: 'var(--color-accent-muted)',
                    color: 'var(--color-accent)',
                  }}
                >
                  N
                </div>
                <div>
                  <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
                    {APP_NAME} v{__APP_VERSION__}
                  </h3>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    Punter Digital Limited
                  </p>
                </div>
              </div>

              {/* Description */}
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                A modern, encrypted SSH client with vault-based credential management,
                multi-session terminals, SFTP file browser, and cross-device sync.
              </p>

              {/* Links */}
              <div className="flex flex-col gap-1.5">
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    // window.nexus.shell.openExternal('https://github.com/punter-digital/nexus');
                  }}
                  className="text-xs flex items-center gap-1.5 py-1 transition-colors"
                  style={{ color: 'var(--color-accent)' }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                  GitHub Repository
                </a>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    // window.nexus.shell.openExternal('https://punterdigital.com');
                  }}
                  className="text-xs flex items-center gap-1.5 py-1 transition-colors"
                  style={{ color: 'var(--color-accent)' }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  Website
                </a>
              </div>

              {/* Update button */}
              <button
                className="btn btn-ghost text-xs self-start"
                onClick={() => addNotification('info', 'You are running the latest version.')}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="1 4 1 10 7 10" />
                  <polyline points="23 20 23 14 17 14" />
                  <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
                </svg>
                Check for Updates
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Section header component
const SectionHeader: React.FC<{ title: string }> = ({ title }) => (
  <div className="mb-2">
    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
      {title}
    </h3>
    <div className="h-px mt-2" style={{ backgroundColor: 'var(--color-border)' }} />
  </div>
);
