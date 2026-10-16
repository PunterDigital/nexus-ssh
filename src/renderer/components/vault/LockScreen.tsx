import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useVaultStore, useUIStore } from '../../stores';
import { APP_NAME } from '../../../shared/constants';
import { CreateVaultDialog } from './CreateVaultDialog';
import { PinUnlockForm } from './PinUnlockForm';
import { ChevronRight, Eye, EyeOff, LoaderCircle, LockKeyhole, SquareTerminal, Usb } from 'lucide-react';
import { Icon } from '../common/Icon';

// ============================================================
// LockScreen — full-screen vault unlock / creation entry point
// ============================================================

type LockScreenMode = 'loading' | 'no-vault' | 'picker' | 'unlock' | 'create';

export function LockScreen(): React.ReactElement {
  const unlockVault = useVaultStore((s) => s.unlockVault);
  const unlockWithHardwareKey = useVaultStore((s) => s.unlockWithHardwareKey);
  const setLockScreenVisible = useUIStore((s) => s.setLockScreenVisible);
  const vaultLoading = useVaultStore((s) => s.loading);
  const vaultError = useVaultStore((s) => s.error);
  const loadAll = useVaultStore((s) => s.loadAll);

  const [mode, setMode] = useState<LockScreenMode>('loading');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [shakeError, setShakeError] = useState(false);
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
    return () => { cancelled = true; };
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
  }, [password, selectedVaultPath, vaultLoading, unlockVault, loadAll, setLockScreenVisible]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleUnlock();
    },
    [handleUnlock],
  );

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
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-bg-secondary)]">
        <div className="flex flex-col items-center gap-4">
          <NexusLogo />
          <Spinner />
        </div>
      </div>
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
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-bg-secondary)]">
        <div className="flex w-[440px] flex-col gap-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-8 shadow-2xl animate-fade-in">
          <div className="flex flex-col items-center gap-2">
            <NexusLogo />
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
              Select a Vault
            </h1>
            <p className="text-xs text-[var(--color-text-muted)]">
              You have {vaultFiles.length} {vaultFiles.length === 1 ? 'vault' : 'vaults'} in your
              vault directory
            </p>
          </div>

          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto pr-1 scrollbar-hidden">
            {vaultFiles.map((file) => {
              const name = file.split(/[/\\]/).pop() ?? file;
              return (
                <button
                  key={file}
                  onClick={() => {
                    setSelectedVaultPath(file);
                    setMode('unlock');
                  }}
                  className="flex items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2.5 text-left transition-colors hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-tertiary)]"
                >
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-[var(--color-accent)]/10">
                    <Icon icon={LockKeyhole} size={16} color="var(--color-accent)" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-[var(--color-text-primary)]">
                      {name.replace(/\.db$/, '')}
                    </div>
                    <div className="truncate text-[10px] text-[var(--color-text-muted)]" title={file}>
                      {file}
                    </div>
                  </div>
                  <Icon icon={ChevronRight} size={10} color="var(--color-text-muted)" />
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-center border-t border-[var(--color-border)] pt-4">
            <button
              onClick={() => setMode('create')}
              className="text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-accent)]"
            >
              Create New Vault
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- No vault exists ---
  if (mode === 'no-vault') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-bg-secondary)]">
        <div className="flex w-96 flex-col items-center gap-8 animate-fade-in">
          <NexusLogo />
          <div className="flex flex-col items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">
              Welcome to {APP_NAME}
            </h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              Secure SSH client with encrypted vault storage
            </p>
          </div>
          <button
            onClick={() => setMode('create')}
            className="rounded-lg bg-[var(--color-accent)] px-6 py-3 text-sm font-semibold text-white transition-all hover:opacity-90 hover:shadow-lg hover:shadow-[var(--color-accent)]/20 active:scale-[0.98]"
          >
            Create Your First Vault
          </button>
        </div>
      </div>
    );
  }

  // --- Unlock existing vault ---
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-bg-secondary)]">
      <div
        className={`flex w-96 flex-col items-center gap-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-8 shadow-2xl animate-fade-in ${
          shakeError ? 'animate-shake' : ''
        }`}
      >
        {/* Branding */}
        <div className="flex flex-col items-center gap-2">
          <NexusLogo />
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
            {APP_NAME}
          </h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {hwKeyPasswordless
              ? 'Touch your hardware key to unlock'
              : usePinMode
                ? 'Enter your PIN to unlock'
                : 'Enter password to unlock'}
          </p>
        </div>

        {/* Selected vault name */}
        {selectedVaultPath && (
          <div className="w-full truncate text-center text-xs text-[var(--color-text-muted)]" title={selectedVaultPath}>
            {(selectedVaultPath.split(/[/\\]/).pop() ?? '').replace(/\.db$/, '')}
          </div>
        )}

        {/* Hardware-key-only (passwordless) vault */}
        {hwKeyPasswordless ? (
          <>
            <button
              onClick={handleHardwareKeyUnlock}
              disabled={vaultLoading}
              className="btn btn-primary flex w-full items-center justify-center gap-2 py-3"
            >
              {vaultLoading ? (
                <>
                  <Spinner size={14} />
                  Touch your key...
                </>
              ) : (
                <>
                  <HardwareKeyIcon />
                  Unlock with Hardware Key
                </>
              )}
            </button>
            {vaultError && (
              <div className="w-full rounded bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
                {vaultError}
              </div>
            )}
          </>
        ) : usePinMode ? (
          /* PIN unlock */
          <PinUnlockForm
            onSuccess={handlePinSuccess}
            onSwitchToPassword={() => setUsePinMode(false)}
          />
        ) : (
          <>
            {/* Password input with show/hide */}
            <div className="relative w-full">
              <input
                ref={passwordRef}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Master password"
                autoFocus
                disabled={vaultLoading}
                className="input w-full pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
                tabIndex={-1}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>

            {/* Error message */}
            {vaultError && (
              <div className="w-full rounded bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
                {vaultError}
              </div>
            )}

            {/* Unlock button */}
            <button
              onClick={handleUnlock}
              disabled={vaultLoading || !password.trim()}
              className="btn btn-primary w-full py-2.5"
            >
              {vaultLoading ? (
                <span className="flex items-center gap-2">
                  <Spinner size={14} />
                  Unlocking...
                </span>
              ) : (
                'Unlock'
              )}
            </button>

            {/* Hardware-key alternative */}
            {hwKeyAvailable && (
              <button
                onClick={handleHardwareKeyUnlock}
                disabled={vaultLoading}
                className="btn btn-ghost flex w-full items-center justify-center gap-2 py-2"
              >
                <HardwareKeyIcon />
                Use Hardware Key Instead
              </button>
            )}
          </>
        )}

        {/* Footer links */}
        <div className="flex w-full flex-col items-center gap-2 border-t border-[var(--color-border)] pt-4">
          {/* "Use PIN instead" link is hidden until PIN setup is exposed in settings */}
          {vaultFiles.length > 1 && (
            <button
              onClick={() => {
                setPassword('');
                setMode('picker');
              }}
              className="text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-accent)]"
            >
              ← Choose a different vault
            </button>
          )}
          <button
            onClick={() => setMode('create')}
            className="text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-accent)]"
          >
            Create New Vault
          </button>
        </div>
      </div>

      {/* Inline style for shake animation */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
        .animate-shake {
          animation: shake 0.5s ease-in-out;
        }
      `}</style>
    </div>
  );
}

// ── Shared sub-components ────────────────────────────────────

function NexusLogo(): React.ReactElement {
  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-accent)]/15">
      <Icon icon={SquareTerminal} size={32} strokeWidth={1.5} color="var(--color-accent)" />
    </div>
  );
}

function Spinner({ size = 20 }: { size?: number }): React.ReactElement {
  return (
    <Icon icon={LoaderCircle} size={size} color="var(--color-accent)" className="animate-spin" />
  );
}

function EyeIcon(): React.ReactElement {
  return (
    <Icon icon={Eye} size={16} />
  );
}

function HardwareKeyIcon(): React.ReactElement {
  return (
    <Icon icon={Usb} size={16} />
  );
}

function EyeOffIcon(): React.ReactElement {
  return (
    <Icon icon={EyeOff} size={16} />
  );
}

export default LockScreen;
