import React, { useState, useEffect, useCallback, useId, useRef } from 'react';
import { ArrowDown, ArrowUp, Check, CircleCheck, CircleX, LoaderCircle, PlugZap } from 'lucide-react';
import { SyncBackendForm } from './SyncBackendForm';
import { SyncHistoryLog, type SyncEvent } from './SyncHistoryLog';
import { useVaultStore } from '../../stores/vault-store';
import { useUIStore } from '../../stores/ui-store';
import { useSyncStatus } from '../../hooks/use-ipc';
import type { BackendConfig, SyncBackendType, SyncInterval, ConflictResolution } from '../../../shared/types';
import { Icon } from '../common/Icon';
import { Button, Card, Field, RadioGroup, Select, Switch } from '../ui';
import type { RadioOption, SelectOption } from '../ui';

// ============================================================
// SyncSettingsView — per-vault sync settings (design system: #2367)
//
// Embedded in Settings → Vault Sync. Four cards: Connection (backend, its fields, Test
// Connection), Schedule (interval, sync on lock / launch, conflicts), Sync now (Push / Pull) and
// History. Every change auto-saves (debounced); the line at the top says when it has.
// ============================================================

const BACKEND_OPTIONS: Array<SelectOption & { value: SyncBackendType; description: string }> = [
  { value: 'sftp', label: 'SFTP', description: 'Sync via SSH file transfer protocol.' },
  { value: 'ftp', label: 'FTP', description: 'Sync via FTP with optional TLS.' },
  { value: 's3', label: 'S3', description: 'Amazon S3, MinIO, B2, R2 compatible.' },
  { value: 'filesystem', label: 'Local Filesystem', description: 'Sync to a local or network-mounted directory.' },
];

const SYNC_INTERVAL_OPTIONS: Array<{ value: SyncInterval; label: string }> = [
  { value: 60, label: 'Every minute' },
  { value: 300, label: 'Every 5 minutes' },
  { value: 900, label: 'Every 15 minutes' },
  { value: 1800, label: 'Every 30 minutes' },
  { value: 0, label: 'Manual only' },
];

const CONFLICT_OPTIONS: RadioOption<ConflictResolution>[] = [
  { value: 'ask', label: 'Ask every time', description: 'Prompt when conflicts are detected' },
  { value: 'keep_local', label: 'Always keep local', description: 'Local changes take priority' },
  { value: 'keep_remote', label: 'Always keep remote', description: 'Remote changes take priority' },
];

/** A labelled on/off row: the label and description on the left, the switch on the right. */
function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col">
        <label htmlFor={id} className="cursor-pointer text-body font-medium text-fg">
          {label}
        </label>
        <p id={`${id}-description`} className="text-body-sm text-fg-muted">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onChange={onChange}
        aria-describedby={`${id}-description`}
        className="mt-0.5"
      />
    </div>
  );
}

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
  // Which button started the running sync (for its spinner); null for a background sync.
  const [manualDirection, setManualDirection] = useState<'push' | 'pull' | null>(null);
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

  // The latest saveConfig, for the unmount flush below.
  const saveConfigRef = useRef(saveConfig);
  useEffect(() => {
    saveConfigRef.current = saveConfig;
  }, [saveConfig]);

  // Debounced auto-save whenever any setting changes
  useEffect(() => {
    if (!loadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    setSaveState('saving');
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      saveConfig();
    }, 400);
  }, [saveConfig]);

  // On unmount, flush any pending debounced save so we don't lose changes when the user
  // navigates away from the sync settings quickly. Runs on unmount only: as a cleanup of an
  // effect on [saveConfig] it also fired on every edit and saved the previous values at once.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        // Fire and forget — can't await in cleanup
        saveConfigRef.current();
      }
    };
  }, []);

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
    setManualDirection(direction);
    try {
      // An edit made in the last 400 ms is still waiting to be saved: save it first, or the
      // sync would run with the previous backend settings.
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        await saveConfig();
      }
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
      setManualDirection(null);
    }
  };

  const sshKeyList = keys.map((k) => ({ id: k.id, name: k.name }));
  const backend = BACKEND_OPTIONS.find((o) => o.value === selectedBackend);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Auto-save indicator */}
      <div aria-live="polite" className="flex min-h-4 items-center justify-end gap-1.5 text-caption text-fg-muted">
        {saveState === 'saving' && (
          <>
            <Icon icon={LoaderCircle} size={12} className="animate-spin" />
            <span>Saving...</span>
          </>
        )}
        {saveState === 'saved' && (
          <span className="flex items-center gap-1.5 text-success">
            <Icon icon={Check} size={12} />
            Saved
          </span>
        )}
        {saveState === 'idle' && <span>Changes save automatically</span>}
      </div>

      <Card title="Connection" description="Where this vault's encrypted copy is stored.">
        <div className="flex flex-col gap-4">
          <Field label="Backend" hint={backend?.description}>
            <Select
              value={selectedBackend}
              onChange={(e) => handleBackendChange(e.target.value as SyncBackendType)}
              options={BACKEND_OPTIONS.map(({ value, label }) => ({ value, label }))}
            />
          </Field>

          <SyncBackendForm
            backendType={selectedBackend}
            config={backendConfig}
            onChange={setBackendConfig}
            sshKeys={sshKeyList}
          />

          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <div>
              <Button icon={PlugZap} loading={testing} onClick={handleTestConnection}>
                Test Connection
              </Button>
            </div>
            <div aria-live="polite">
              {testResult === 'success' && (
                <p className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-body-sm text-success">
                  <Icon icon={CircleCheck} size={14} />
                  Connection successful
                </p>
              )}
              {testResult === 'fail' && (
                <p className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-body-sm text-danger">
                  <Icon icon={CircleX} size={14} className="mt-0.5" />
                  <span className="min-w-0 break-words">
                    {testError ? `Connection failed: ${testError}` : 'Connection failed'}
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card title="Schedule" description="When this vault syncs on its own, and what wins when both sides changed.">
        <div className="flex flex-col gap-4">
          <Field label="Sync interval">
            <Select
              value={String(syncInterval)}
              onChange={(e) => setSyncInterval(Number(e.target.value) as SyncInterval)}
              options={SYNC_INTERVAL_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
            />
          </Field>

          <SwitchRow
            label="Sync on vault lock"
            description="Automatically push changes when locking the vault"
            checked={syncOnLock}
            onChange={setSyncOnLock}
          />
          <SwitchRow
            label="Sync on app launch"
            description="Automatically pull remote changes at startup"
            checked={syncOnLaunch}
            onChange={setSyncOnLaunch}
          />

          <RadioGroup
            label="Conflict resolution"
            showLabel
            variant="list"
            value={conflictResolution}
            onChange={setConflictResolution}
            options={CONFLICT_OPTIONS}
          />
        </div>
      </Card>

      <Card title="Sync now" description="Push uploads this vault to the backend. Pull downloads the copy stored there.">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            icon={ArrowUp}
            loading={manualDirection === 'push'}
            disabled={syncing}
            onClick={() => handleSyncNow('push')}
          >
            Push
          </Button>
          <Button
            icon={ArrowDown}
            loading={manualDirection === 'pull'}
            disabled={syncing}
            onClick={() => handleSyncNow('pull')}
          >
            Pull
          </Button>
          <span aria-live="polite" className="flex items-center gap-1.5 text-body-sm text-fg-muted">
            {syncing && (
              <>
                <Icon icon={LoaderCircle} size={12} className="animate-spin" />
                Syncing...
              </>
            )}
          </span>
        </div>
      </Card>

      <Card title="History" description="The latest syncs of this vault, newest first.">
        <div className="-mx-4 -mb-4 border-t border-line">
          <SyncHistoryLog events={syncHistory} />
        </div>
      </Card>
    </div>
  );
};
