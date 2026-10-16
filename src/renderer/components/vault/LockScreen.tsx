import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useVaultStore, useUIStore } from '../../stores';
import { APP_NAME } from '../../../shared/constants';
import { CreateVaultDialog } from './CreateVaultDialog';
import { PinUnlockForm } from './PinUnlockForm';
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Usb,
} from 'lucide-react';
import { Icon } from '../common/Icon';
import { Button, Field, PasswordInput, cx } from '../ui';
import { LockCard, LockLayout, NexusLogo, UnlockError } from './LockLayout';

// ============================================================
// LockScreen — full-screen vault unlock / creation entry point (design system: #2366)
// ============================================================

type LockScreenMode = 'loading' | 'no-vault' | 'picker' | 'unlock' | 'create';

const vaultDisplayName = (file: string) =>
  (file.split(/[/\\]/).pop() ?? file).replace(/\.db$/, '');

export function LockScreen(): React.ReactElement {
  const unlockVault = useVaultStore((s) => s.unlockVault);
  const unlockWithHardwareKey = useVaultStore((s) => s.unlockWithHardwareKey);
  const setLockScreenVisible = useUIStore((s) => s.setLockScreenVisible);
  const vaultLoading = useVaultStore((s) => s.loading);
  const vaultError = useVaultStore((s) => s.error);
  const loadAll = useVaultStore((s) => s.loadAll);

  const [mode, setMode] = useState<LockScreenMode>('loading');
  const [password, setPassword] = useState('');
  const [shakeError, setShakeError] = useState(false);
  // PIN unlock isn't wired up in the main process yet; nothing turns this on.
  const [usePinMode, setUsePinMode] = useState(false);
  const [vaultFiles, setVaultFiles] = useState<string[]>([]);
  const [selectedVaultPath, setSelectedVaultPath] = useState<string>('');
  const [hwKeyAvailable, setHwKeyAvailable] = useState(false);
  const [hwKeyPasswordless, setHwKeyPasswordless] = useState(false);

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
    if (mode === 'unlock' && !usePinMode) {
      passwordRef.current?.focus();
    }
  }, [mode, usePinMode]);

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

  const handlePinSuccess = useCallback(async () => {
    await loadAll();
    setLockScreenVisible(false);
  }, [loadAll, setLockScreenVisible]);

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

          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {vaultFiles.map((file) => (
              <li key={file}>
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
                </button>
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
  const prompt = hwKeyPasswordless
    ? 'Touch your hardware key to unlock'
    : usePinMode
      ? 'Enter your PIN to unlock'
      : 'Enter password to unlock';

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

        {hwKeyPasswordless ? (
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
          </div>
        ) : usePinMode ? (
          <PinUnlockForm
            onSuccess={handlePinSuccess}
            onSwitchToPassword={() => setUsePinMode(false)}
          />
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
          </form>
        )}

        {/* Footer links. ("Use PIN instead" stays hidden until PIN unlock exists.) */}
        <div className="flex flex-wrap items-center justify-center gap-2 border-t border-line pt-4">
          {vaultFiles.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              icon={ChevronLeft}
              onClick={() => {
                setPassword('');
                setMode('picker');
              }}
            >
              Choose a different vault
            </Button>
          )}
          <Button variant="ghost" size="sm" icon={Plus} onClick={() => setMode('create')}>
            Create New Vault
          </Button>
        </div>
      </LockCard>
    </LockLayout>
  );
}

export default LockScreen;
