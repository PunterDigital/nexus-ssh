import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useVaultStore, useUIStore } from '../../stores';
import { APP_NAME } from '../../../shared/constants';
import { CreateVaultDialog } from './CreateVaultDialog';
import { PinUnlockForm } from './PinUnlockForm';
import { DeleteVaultDialog, RenameVaultDialog, vaultDisplayName } from './VaultPickerDialogs';
import {
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  Pencil,
  Trash2,
  LockKeyhole,
  Plus,
  Usb,
} from 'lucide-react';
import { Icon } from '../common/Icon';
import { Button, Field, IconButton, Menu, PasswordInput, cx, type MenuEntry } from '../ui';
import { LockCard, LockLayout, NexusLogo, UnlockError } from './LockLayout';

// ============================================================
// LockScreen — full-screen vault unlock / creation entry point (design system: #2366)
// ============================================================

type LockScreenMode = 'loading' | 'no-vault' | 'picker' | 'unlock' | 'create';

/** How the open unlock card asks for the vault: PIN, password (or the hardware-key button), or a picker. */
type UnlockMethod = 'pin' | 'password' | 'choose';

export function LockScreen(): React.ReactElement {
  const unlockVault = useVaultStore((s) => s.unlockVault);
  const unlockWithHardwareKey = useVaultStore((s) => s.unlockWithHardwareKey);
  const setLockScreenVisible = useUIStore((s) => s.setLockScreenVisible);
  const vaultLoading = useVaultStore((s) => s.loading);
  const vaultError = useVaultStore((s) => s.error);
  const loadAll = useVaultStore((s) => s.loadAll);
  const addNotification = useUIStore((s) => s.addNotification);

  const [mode, setMode] = useState<LockScreenMode>('loading');
  const [password, setPassword] = useState('');
  const [shakeError, setShakeError] = useState(false);
  // PIN quick-unlock (#2653): on for a vault once set up in Settings, until Nexus quits
  const [method, setMethod] = useState<UnlockMethod>('password');
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pinNotice, setPinNotice] = useState<string | null>(null);
  const [vaultFiles, setVaultFiles] = useState<string[]>([]);
  const [selectedVaultPath, setSelectedVaultPath] = useState<string>('');
  const [hwKeyAvailable, setHwKeyAvailable] = useState(false);
  const [hwKeyPasswordless, setHwKeyPasswordless] = useState(false);
  // Vault picker actions (#2646)
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const passwordRef = useRef<HTMLInputElement>(null);

  // Discover vaults on mount
  useEffect(() => {
    let cancelled = false;
    // "Switch vault" (#2363) asks for the picker even when there is only one vault, so the
    // user can create another one or pick the same one again.
    const pickerRequested = useUIStore.getState().vaultPickerRequested;
    (async () => {
      try {
        const files = (await window.nexus.vault.list()) as string[];
        if (cancelled) return;
        if (!files || files.length === 0) {
          setMode('no-vault');
          return;
        }
        setVaultFiles(files);
        if (files.length === 1 && !pickerRequested) {
          // Single vault — skip picker, go straight to password entry
          setSelectedVaultPath(files[0]);
          setMode('unlock');
        } else {
          // Multiple vaults — show the picker
          setMode('picker');
        }
      } catch {
        if (!cancelled) setMode('no-vault');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Trigger shake animation on error
  useEffect(() => {
    if (vaultError) {
      setShakeError(true);
      const timer = setTimeout(() => setShakeError(false), 500);
      return () => clearTimeout(timer);
    }
  }, [vaultError]);

  // Focus password input when entering unlock mode
  useEffect(() => {
    if (mode === 'unlock' && method === 'password') {
      passwordRef.current?.focus();
    }
  }, [mode, method]);

  // Ask main whether the selected vault has PIN unlock, each time its unlock card opens
  useEffect(() => {
    let cancelled = false;
    setPinEnabled(false);
    setPinNotice(null);
    setMethod('password');
    if (!selectedVaultPath || mode !== 'unlock') return;
    window.nexus.pin
      .status(selectedVaultPath)
      .then((status) => {
        if (cancelled || !status.enabled) return;
        setPinEnabled(true);
        setMethod('pin');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedVaultPath, mode]);

  // Detect whether a hardware key has been registered for the selected vault
  useEffect(() => {
    let cancelled = false;
    setHwKeyAvailable(false);
    setHwKeyPasswordless(false);
    if (!selectedVaultPath) return;
    (async () => {
      try {
        const has = await window.nexus.hardwareKey.has(selectedVaultPath);
        if (cancelled) return;
        setHwKeyAvailable(has);
        if (has) {
          try {
            const info = await window.nexus.hardwareKey.getInfo(selectedVaultPath);
            if (!cancelled) setHwKeyPasswordless(!!info?.passwordless);
          } catch {
            // ignore — we already know a key is registered
          }
        }
      } catch {
        if (!cancelled) setHwKeyAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedVaultPath]);

  /** Re-read the vault folder after a rename or delete; the picker stays open while any are left. */
  const refreshVaults = useCallback(async () => {
    try {
      const files = (await window.nexus.vault.list()) as string[];
      setVaultFiles(files ?? []);
      setMode(files && files.length > 0 ? 'picker' : 'no-vault');
    } catch {
      setMode('no-vault');
    }
  }, []);

  const vaultActions = useCallback(
    (file: string): MenuEntry[] => [
      { id: 'rename', label: 'Rename…', icon: Pencil, onSelect: () => setRenameTarget(file) },
      {
        id: 'show',
        label: 'Show in Folder',
        icon: FolderOpen,
        onSelect: () => {
          window.nexus.vault.showInFolder(file).catch((err: unknown) => {
            addNotification('error', err instanceof Error ? err.message : String(err));
          });
        },
      },
      { id: 'sep', separator: true },
      { id: 'delete', label: 'Delete…', icon: Trash2, danger: true, onSelect: () => setDeleteTarget(file) },
    ],
    [addNotification]
  );

  const handleRenamed = useCallback(
    async (from: string, to: string) => {
      setRenameTarget(null);
      if (selectedVaultPath === from) setSelectedVaultPath(to);
      addNotification('success', `Renamed to ${vaultDisplayName(to)}`);
      await refreshVaults();
    },
    [selectedVaultPath, addNotification, refreshVaults]
  );

  const handleDeleted = useCallback(
    async (file: string) => {
      setDeleteTarget(null);
      if (selectedVaultPath === file) setSelectedVaultPath('');
      addNotification('success', `Deleted ${vaultDisplayName(file)}`);
      await refreshVaults();
    },
    [selectedVaultPath, addNotification, refreshVaults]
  );

  const handleUnlock = useCallback(async () => {
    if (!password.trim() || vaultLoading) return;
    try {
      await unlockVault(password, selectedVaultPath || undefined);
      await loadAll();
      setLockScreenVisible(false);
    } catch {
      // Error is set in the store; shake animation handles UX
      setPassword('');
    }
  }, [
    password,
    selectedVaultPath,
    vaultLoading,
    unlockVault,
    loadAll,
    setLockScreenVisible,
  ]);

  const handleHardwareKeyUnlock = useCallback(async () => {
    if (!selectedVaultPath || vaultLoading) return;
    try {
      // unlockWithHardwareKey already calls loadAll() once the vault is open.
      await unlockWithHardwareKey(selectedVaultPath);
      setLockScreenVisible(false);
    } catch {
      // Error displayed via store; trigger shake on the card
    }
  }, [selectedVaultPath, vaultLoading, unlockWithHardwareKey, setLockScreenVisible]);

  // unlockWithPin already loads the vault's data
  const handlePinSuccess = useCallback(() => {
    setLockScreenVisible(false);
  }, [setLockScreenVisible]);

  const handlePinDisabled = useCallback((notice: string) => {
    setPinEnabled(false);
    setPinNotice(notice);
    setMethod('choose');
  }, []);

  const handleCreateSuccess = useCallback(async () => {
    await loadAll();
    setLockScreenVisible(false);
  }, [loadAll, setLockScreenVisible]);

  // --- Loading state ---
  if (mode === 'loading') {
    return (
      <LockLayout>
        <div className="flex flex-col items-center gap-4" aria-busy="true">
          <NexusLogo />
          <Icon icon={LoaderCircle} size={20} className="animate-spin text-accent" />
        </div>
      </LockLayout>
    );
  }

  // --- Create vault mode ---
  if (mode === 'create') {
    return (
      <CreateVaultDialog
        onSuccess={handleCreateSuccess}
        onBack={() => {
          if (vaultFiles.length > 1) setMode('picker');
          else if (vaultFiles.length === 1) setMode('unlock');
          else setMode('no-vault');
        }}
      />
    );
  }

  // --- Picker (multiple vaults) ---
  if (mode === 'picker') {
    return (
      <LockLayout>
        <LockCard>
          <div className="flex flex-col items-center gap-3 text-center">
            <NexusLogo />
            <h1 className="text-heading font-semibold text-fg">Select a Vault</h1>
            <p className="text-body-sm text-fg-muted">
              You have {vaultFiles.length} {vaultFiles.length === 1 ? 'vault' : 'vaults'}{' '}
              in your vault directory
            </p>
          </div>

          {/* No scroll box here: a row's menu would be clipped. The backdrop scrolls instead. */}
          <ul className="flex flex-col gap-2">
            {vaultFiles.map((file) => (
              <li key={file} className="group relative">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedVaultPath(file);
                    setMode('unlock');
                  }}
                  className={cx(
                    'group flex w-full items-center gap-3 rounded-lg border border-line bg-surface-raised p-3 text-left',
                    'transition-colors duration-(--duration-fast) ease-standard hover:border-line-strong hover:bg-surface-hover focus-ring-inset'
                  )}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                    <Icon icon={LockKeyhole} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold text-fg">
                      {vaultDisplayName(file)}
                    </span>
                    <span
                      className="block truncate font-code text-caption text-fg-muted"
                      title={file}
                    >
                      {file}
                    </span>
                  </span>
                  <Icon
                    icon={ChevronRight}
                    size={14}
                    className="shrink-0 text-fg-muted group-hover:text-fg"
                  />
                  {/* Room for the actions button, which sits on top of the row */}
                  <span className="size-7 shrink-0" aria-hidden="true" />
                </button>
                {/* No transform here: it would trap the menu under the next row */}
                <div className="absolute inset-y-0 right-3 flex items-center">
                  <Menu
                    align="end"
                    label={`Actions for ${vaultDisplayName(file)}`}
                    items={vaultActions(file)}
                    trigger={(p) => (
                      <IconButton
                        {...p}
                        icon={Ellipsis}
                        label={`More actions for ${vaultDisplayName(file)}`}
                        size="sm"
                      />
                    )}
                  />
                </div>
              </li>
            ))}
          </ul>

          <div className="flex justify-center border-t border-line pt-4">
            <Button
              variant="ghost"
              size="sm"
              icon={Plus}
              onClick={() => setMode('create')}
            >
              Create New Vault
            </Button>
          </div>
        </LockCard>
        <RenameVaultDialog
          vaultPath={renameTarget}
          onClose={() => setRenameTarget(null)}
          onRenamed={(from, to) => void handleRenamed(from, to)}
        />
        <DeleteVaultDialog
          vaultPath={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={(file) => void handleDeleted(file)}
        />
      </LockLayout>
    );
  }

  // --- No vault exists ---
  if (mode === 'no-vault') {
    return (
      <LockLayout>
        <div className="flex max-w-sm flex-col items-center gap-8 text-center animate-fade-in">
          <NexusLogo size="lg" />
          <div className="flex flex-col items-center gap-2">
            <h1 className="text-display font-semibold tracking-tight text-fg">
              Welcome to {APP_NAME}
            </h1>
            <p className="text-body-lg text-fg-muted">
              Secure SSH client with encrypted vault storage
            </p>
          </div>
          <Button variant="primary" size="lg" onClick={() => setMode('create')}>
            Create Your First Vault
          </Button>
        </div>
      </LockLayout>
    );
  }

  // --- Unlock existing vault ---
  const prompt =
    method === 'choose'
      ? 'Choose how to unlock'
      : method === 'pin' && pinEnabled
        ? 'Enter your PIN to unlock'
        : hwKeyPasswordless
          ? 'Touch your hardware key to unlock'
          : 'Enter password to unlock';

  const anotherMethod = pinEnabled && (
    <Button variant="ghost" size="sm" disabled={vaultLoading} onClick={() => setMethod('choose')}>
      Use another method
    </Button>
  );

  return (
    <LockLayout>
      <LockCard className={shakeError ? 'animate-shake' : undefined}>
        <div className="flex flex-col items-center gap-3 text-center">
          <NexusLogo />
          <div className="flex flex-col items-center gap-1">
            <h1 className="text-heading font-semibold tracking-tight text-fg">
              {APP_NAME}
            </h1>
            {selectedVaultPath && (
              <p
                className="max-w-full truncate text-body font-medium text-fg-secondary"
                title={selectedVaultPath}
              >
                {vaultDisplayName(selectedVaultPath)}
              </p>
            )}
            <p className="text-body-sm text-fg-muted">{prompt}</p>
          </div>
        </div>

        {method === 'choose' ? (
          <div className="flex flex-col gap-3">
            {pinNotice && <UnlockError message={pinNotice} />}
            <ul className="flex flex-col gap-2" aria-label="Unlock methods">
              {pinEnabled && (
                <li>
                  <Button fullWidth icon={KeyRound} onClick={() => setMethod('pin')}>
                    PIN
                  </Button>
                </li>
              )}
              {!hwKeyPasswordless && (
                <li>
                  <Button
                    fullWidth
                    variant={pinEnabled ? 'secondary' : 'primary'}
                    icon={LockKeyhole}
                    onClick={() => setMethod('password')}
                  >
                    Master Password
                  </Button>
                </li>
              )}
              {hwKeyAvailable && (
                <li>
                  <Button
                    fullWidth
                    icon={Usb}
                    loading={vaultLoading}
                    onClick={handleHardwareKeyUnlock}
                  >
                    Hardware Key
                  </Button>
                </li>
              )}
            </ul>
            <UnlockError message={vaultError} />
          </div>
        ) : method === 'pin' && pinEnabled ? (
          <PinUnlockForm
            vaultPath={selectedVaultPath}
            onUnlocked={handlePinSuccess}
            onPinDisabled={handlePinDisabled}
            onUseAnotherMethod={() => setMethod('choose')}
          />
        ) : hwKeyPasswordless ? (
          /* Hardware-key-only (passwordless) vault */
          <div className="flex flex-col gap-3">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              icon={Usb}
              loading={vaultLoading}
              onClick={handleHardwareKeyUnlock}
            >
              {vaultLoading ? 'Touch your key…' : 'Unlock with Hardware Key'}
            </Button>
            <UnlockError message={vaultError} />
            {anotherMethod}
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void handleUnlock();
            }}
          >
            <Field label="Master password">
              <PasswordInput
                ref={passwordRef}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Master password"
                autoFocus
                disabled={vaultLoading}
                invalid={Boolean(vaultError)}
              />
            </Field>

            <UnlockError message={vaultError} />

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={vaultLoading}
              disabled={!password.trim()}
            >
              {vaultLoading ? 'Unlocking…' : 'Unlock'}
            </Button>

            {hwKeyAvailable && (
              <Button
                variant="secondary"
                fullWidth
                icon={Usb}
                disabled={vaultLoading}
                onClick={handleHardwareKeyUnlock}
              >
                Use Hardware Key Instead
              </Button>
            )}
            {anotherMethod}
          </form>
        )}

        {/* Footer links */}
        <div className="flex flex-wrap items-center justify-center gap-2 border-t border-line pt-4">
          {/* With one vault this is the way to rename or delete it (#2646). */}
          <Button
            variant="ghost"
            size="sm"
            icon={ChevronLeft}
            onClick={() => {
              setPassword('');
              setMode('picker');
            }}
          >
            {vaultFiles.length > 1 ? 'Choose a different vault' : 'Manage vaults'}
          </Button>
          <Button variant="ghost" size="sm" icon={Plus} onClick={() => setMode('create')}>
            Create New Vault
          </Button>
        </div>
      </LockCard>
    </LockLayout>
  );
}

export default LockScreen;
