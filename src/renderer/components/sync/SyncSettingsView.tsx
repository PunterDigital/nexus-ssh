import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SyncBackendForm } from './SyncBackendForm';
import { SyncHistoryLog, type SyncEvent } from './SyncHistoryLog';
import { useVaultStore } from '../../stores/vault-store';
import { useUIStore } from '../../stores/ui-store';
import { useSyncStatus } from '../../hooks/use-ipc';
import type { BackendConfig, SyncBackendType, SyncInterval, ConflictResolution } from '../../../shared/types';
import { ArrowDown, ArrowUp, Check, CircleCheck, CircleX, Database, Folder, LoaderCircle, LockKeyhole, Server } from 'lucide-react';
import { Icon } from '../common/Icon';

// ============================================================
// SyncSettingsView — Full sync settings panel (per-vault)
// ============================================================

interface BackendOption {
  type: SyncBackendType;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const BACKEND_OPTIONS: BackendOption[] = [
  {
    type: 'sftp',
    label: 'SFTP',
    description: 'Sync via SSH file transfer protocol',
    icon: (
      <Icon icon={LockKeyhole} size={20} />
    ),
  },
  {
    type: 'ftp',
    label: 'FTP',
    description: 'Sync via FTP with optional TLS',
    icon: (
      <Icon icon={Server} size={20} />
    ),
  },
  {
    type: 's3',
    label: 'S3',
    description: 'Amazon S3, MinIO, B2, R2 compatible',
    icon: (
      <Icon icon={Database} size={20} />
    ),
  },
  {
    type: 'filesystem',
    label: 'Local Filesystem',
    description: 'Sync to a local or network-mounted directory',
    icon: (
      <Icon icon={Folder} size={20} />
    ),
  },
];

const SYNC_INTERVAL_OPTIONS: Array<{ value: SyncInterval; label: string }> = [
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
  { value: 900, label: '15 minutes' },
  { value: 1800, label: '30 minutes' },
  { value: 0, label: 'Manual only' },
];

const CONFLICT_OPTIONS: Array<{ value: ConflictResolution; label: string; description: string }> = [
  { value: 'ask', label: 'Ask every time', description: 'Prompt when conflicts are detected' },
  { value: 'keep_local', label: 'Always keep local', description: 'Local changes take priority' },
  { value: 'keep_remote', label: 'Always keep remote', description: 'Remote changes take priority' },
];

export const SyncSettingsView: React.FC = () => {
  const keys = useVaultStore((s) => s.keys);
  const addNotification = useUIStore((s) => s.addNotification);

  // Backend selection
  const [selectedBackend, setSelectedBackend] = useState<SyncBackendType>('sftp');
  const [backendConfig, setBackendConfig] = useState<BackendConfig>({ type: 'sftp' });

  // Connection test
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Sync settings
  const [syncInterval, setSyncInterval] = useState<SyncInterval>(300);
  const [syncOnLock, setSyncOnLock] = useState(true);
  const [syncOnLaunch, setSyncOnLaunch] = useState(true);
  const [conflictResolution, setConflictResolution] = useState<ConflictResolution>('ask');

  // Sync status / history
  const [syncing, setSyncing] = useState(false);
  const [syncHistory, setSyncHistory] = useState<SyncEvent[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Track whether initial load is complete so we don't auto-save on mount
  const loadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for sync status updates
  const handleSyncStatus = useCallback((status: unknown) => {
    const data = status as { state?: string; event?: SyncEvent };
    if (data.state === 'syncing') {
      setSyncing(true);
    } else if (data.state === 'idle' || data.state === 'synced') {
      setSyncing(false);
    }
    if (data.event) {
      setSyncHistory((prev) => [data.event!, ...prev].slice(0, 20));
    }
  }, []);

  useSyncStatus(handleSyncStatus);

  // Load existing config on mount
  useEffect(() => {
    (async () => {
      try {
        const config = await window.nexus.sync.getConfig();
        if (config) {
          const parsed = config as {
            backendType?: SyncBackendType;
            backendConfig?: BackendConfig;
            syncInterval?: SyncInterval;
            syncOnLock?: boolean;
            syncOnLaunch?: boolean;
            conflictResolution?: ConflictResolution;
            history?: SyncEvent[];
          };
          if (parsed.backendType) setSelectedBackend(parsed.backendType);
          if (parsed.backendConfig) setBackendConfig(parsed.backendConfig);
          if (parsed.syncInterval !== undefined) setSyncInterval(parsed.syncInterval);
          if (parsed.syncOnLock !== undefined) setSyncOnLock(parsed.syncOnLock);
          if (parsed.syncOnLaunch !== undefined) setSyncOnLaunch(parsed.syncOnLaunch);
          if (parsed.conflictResolution) setConflictResolution(parsed.conflictResolution);
          if (parsed.history) setSyncHistory(parsed.history);
        }
      } catch {
        // No config yet — use defaults
      } finally {
        // Mark loaded so auto-save can kick in from here
        loadedRef.current = true;
      }
    })();
  }, []);

  // Helper that actually writes the config to the backend
  const saveConfig = useCallback(async () => {
    try {
      await window.nexus.sync.configure({
        backendType: selectedBackend,
        backendConfig,
        syncInterval,
        syncOnLock,
        syncOnLaunch,
        conflictResolution,
      });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch (err) {
      setSaveState('idle');
      addNotification('error', `Failed to save: ${(err as Error).message}`);
    }
  }, [
    selectedBackend,
    backendConfig,
    syncInterval,
    syncOnLock,
    syncOnLaunch,
    conflictResolution,
    addNotification,
  ]);

  // Debounced auto-save whenever any setting changes
  useEffect(() => {
    if (!loadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    setSaveState('saving');
    saveTimerRef.current = setTimeout(() => {
      saveConfig();
    }, 400);
  }, [saveConfig]);

  // On unmount, flush any pending debounced save so we don't lose changes
  // when the user navigates away from the sync settings tab quickly.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        // Fire and forget — can't await in cleanup
        saveConfig();
      }
    };
  }, [saveConfig]);

  const handleBackendChange = (type: SyncBackendType) => {
    setSelectedBackend(type);
    setBackendConfig({ type });
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const result = await window.nexus.sync.testConnection(backendConfig);
      setTestResult(result ? 'success' : 'fail');
    } catch (err) {
      setTestResult('fail');
      // e.g. a rejected or changed SFTP host key: say why, not just "failed".
      setTestError((err as Error).message || null);
    } finally {
      setTesting(false);
    }
  };

  const handleSyncNow = async (direction: 'push' | 'pull') => {
    setSyncing(true);
    try {
      if (direction === 'push') {
        await window.nexus.sync.push();
      } else {
        await window.nexus.sync.pull();
      }
      addNotification('success', `Sync ${direction} completed`);
    } catch (err) {
      addNotification('error', `Sync ${direction} failed: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const sshKeyList = keys.map((k) => ({ id: k.id, name: k.name }));

  return (
    <div className="flex flex-col" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      {/* Auto-save indicator */}
      <div className="flex items-center justify-end gap-1.5 px-1 py-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
        {saveState === 'saving' && (
          <>
            <Icon icon={LoaderCircle} size={10} className="animate-spin" />
            <span>Saving...</span>
          </>
        )}
        {saveState === 'saved' && (
          <>
            <Icon icon={Check} size={10} color="var(--color-success)" />
            <span style={{ color: 'var(--color-success)' }}>Saved</span>
          </>
        )}
        {saveState === 'idle' && <span>Changes save automatically</span>}
      </div>

      {/* Content */}
      <div className="flex-1">
        <div className="flex flex-col gap-8">

          {/* Section: Backend Selection */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-muted)' }}>
              Backend
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {BACKEND_OPTIONS.map((opt) => (
                <button
                  key={opt.type}
                  className="flex items-start gap-3 p-3 rounded-lg border text-left transition-colors"
                  style={{
                    borderColor: selectedBackend === opt.type ? 'var(--color-accent)' : 'var(--color-border)',
                    backgroundColor: selectedBackend === opt.type ? 'var(--color-accent-muted)' : 'var(--color-bg-secondary)',
                  }}
                  onClick={() => handleBackendChange(opt.type)}
                >
                  <div
                    className="shrink-0 mt-0.5"
                    style={{ color: selectedBackend === opt.type ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
                  >
                    {opt.icon}
                  </div>
                  <div className="flex flex-col">
                    <span
                      className="text-xs font-semibold"
                      style={{ color: selectedBackend === opt.type ? 'var(--color-accent)' : 'var(--color-text-primary)' }}
                    >
                      {opt.label}
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {opt.description}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Section: Backend Configuration */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-muted)' }}>
              Configuration
            </h2>
            <div
              className="p-4 rounded-lg border"
              style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)' }}
            >
              <SyncBackendForm
                backendType={selectedBackend}
                config={backendConfig}
                onChange={setBackendConfig}
                sshKeys={sshKeyList}
              />
            </div>
          </section>

          {/* Section: Connection Test */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-muted)' }}>
              Connection Test
            </h2>
            <div className="flex items-center gap-3">
              <button
                className="btn btn-ghost"
                style={{ border: '1px solid var(--color-border)' }}
                onClick={handleTestConnection}
                disabled={testing}
              >
                {testing ? (
                  <>
                    <Icon icon={LoaderCircle} size={14} className="animate-spin" />
                    Testing...
                  </>
                ) : (
                  'Test Connection'
                )}
              </button>
              {testResult === 'success' && (
                <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-success)' }}>
                  <Icon icon={CircleCheck} size={14} />
                  Connection successful
                </span>
              )}
              {testResult === 'fail' && (
                <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-danger)' }}>
                  <Icon icon={CircleX} size={14} />
                  {testError ? `Connection failed: ${testError}` : 'Connection failed'}
                </span>
              )}
            </div>
          </section>

          {/* Section: Sync Settings */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-muted)' }}>
              Sync Schedule
            </h2>
            <div
              className="flex flex-col gap-4 p-4 rounded-lg border"
              style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)' }}
            >
              {/* Sync interval */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  Sync Interval
                </label>
                <div className="flex flex-wrap gap-2">
                  {SYNC_INTERVAL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className="px-3 py-1.5 rounded-md border text-xs font-medium transition-colors"
                      style={{
                        borderColor: syncInterval === opt.value ? 'var(--color-accent)' : 'var(--color-border)',
                        backgroundColor: syncInterval === opt.value ? 'var(--color-accent-muted)' : 'transparent',
                        color: syncInterval === opt.value ? 'var(--color-accent)' : 'var(--color-text-muted)',
                      }}
                      onClick={() => setSyncInterval(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Toggle: sync on lock */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                    Sync on vault lock
                  </span>
                  <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    Automatically push changes when locking the vault
                  </p>
                </div>
                <button
                  className="relative w-9 h-5 rounded-full transition-colors"
                  style={{
                    backgroundColor: syncOnLock ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
                    border: `1px solid ${syncOnLock ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  }}
                  onClick={() => setSyncOnLock(!syncOnLock)}
                  role="switch"
                  aria-checked={syncOnLock}
                >
                  <span
                    className="absolute top-0.5 w-3.5 h-3.5 rounded-full transition-transform"
                    style={{
                      backgroundColor: '#fff',
                      transform: syncOnLock ? 'translateX(17px)' : 'translateX(2px)',
                    }}
                  />
                </button>
              </div>

              {/* Toggle: sync on launch */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                    Sync on app launch
                  </span>
                  <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    Automatically pull remote changes at startup
                  </p>
                </div>
                <button
                  className="relative w-9 h-5 rounded-full transition-colors"
                  style={{
                    backgroundColor: syncOnLaunch ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
                    border: `1px solid ${syncOnLaunch ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  }}
                  onClick={() => setSyncOnLaunch(!syncOnLaunch)}
                  role="switch"
                  aria-checked={syncOnLaunch}
                >
                  <span
                    className="absolute top-0.5 w-3.5 h-3.5 rounded-full transition-transform"
                    style={{
                      backgroundColor: '#fff',
                      transform: syncOnLaunch ? 'translateX(17px)' : 'translateX(2px)',
                    }}
                  />
                </button>
              </div>

              {/* Conflict resolution */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  Conflict Resolution
                </label>
                <div className="flex flex-col gap-1">
                  {CONFLICT_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex items-start gap-2.5 p-2 rounded-md cursor-pointer transition-colors"
                      style={{
                        backgroundColor: conflictResolution === opt.value ? 'var(--color-accent-muted)' : 'transparent',
                      }}
                    >
                      <input
                        type="radio"
                        name="conflictResolution"
                        value={opt.value}
                        checked={conflictResolution === opt.value}
                        onChange={() => setConflictResolution(opt.value)}
                        className="mt-0.5 accent-[var(--color-accent)]"
                      />
                      <div className="flex flex-col">
                        <span
                          className="text-xs font-medium"
                          style={{ color: conflictResolution === opt.value ? 'var(--color-accent)' : 'var(--color-text-primary)' }}
                        >
                          {opt.label}
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          {opt.description}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Section: Manual Sync */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-muted)' }}>
              Manual Sync
            </h2>
            <div className="flex items-center gap-2">
              <button
                className="btn btn-primary"
                onClick={() => handleSyncNow('push')}
                disabled={syncing}
              >
                {syncing ? (
                  <>
                    <Icon icon={LoaderCircle} size={14} className="animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <Icon icon={ArrowUp} size={14} />
                    Push
                  </>
                )}
              </button>
              <button
                className="btn btn-ghost"
                style={{ border: '1px solid var(--color-border)' }}
                onClick={() => handleSyncNow('pull')}
                disabled={syncing}
              >
                <Icon icon={ArrowDown} size={14} />
                Pull
              </button>
            </div>
          </section>

          {/* Section: Sync History */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-muted)' }}>
              Sync History
            </h2>
            <SyncHistoryLog events={syncHistory} />
          </section>

        </div>
      </div>
    </div>
  );
};
