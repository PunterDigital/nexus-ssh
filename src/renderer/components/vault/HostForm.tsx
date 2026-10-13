import React, { useState, useMemo } from 'react';
import { Modal } from '../common/Modal';
import { ColourPicker } from '../common/ColourPicker';
import { useVaultStore } from '../../stores/vault-store';
import { useUIStore } from '../../stores/ui-store';
import type { Host, OSType } from '../../../shared/types';

// ============================================================
// HostForm — Single-column scrollable host create/edit form
// ============================================================

type AuthMethod = 'password' | 'identity' | 'key';

interface HostFormData {
  label: string;
  hostname: string;
  port: string;
  username: string;
  password: string;
  authMethod: AuthMethod;
  identityId: string;
  keyId: string;
  groupId: string;
  tagIds: string[];
  colour: string | null;
  osType: OSType | '';
  keepaliveInterval: string;
  compression: boolean;
  notes: string;
}

interface Errors {
  [key: string]: string | undefined;
}

export interface HostFormProps {
  open: boolean;
  onClose: () => void;
  host?: Host;
  hostTagIds?: string[];
}

const OS_TYPES: { value: OSType; label: string }[] = [
  { value: 'linux', label: 'Linux' },
  { value: 'windows', label: 'Windows' },
  { value: 'macos', label: 'macOS' },
  { value: 'freebsd', label: 'FreeBSD' },
  { value: 'other', label: 'Other' },
];

export const HostForm: React.FC<HostFormProps> = ({
  open,
  onClose,
  host,
  hostTagIds = [],
}) => {
  const { groups, identities, keys, tags, addHost, updateHost, addTag, selectedVaultId } =
    useVaultStore();
  const { addNotification } = useUIStore();

  const isEditing = !!host;

  const initialAuth: AuthMethod = host
    ? host.key_id
      ? 'key'
      : host.identity_id
        ? 'identity'
        : host.password
          ? 'password'
          : 'key'
    : 'password';

  const [form, setForm] = useState<HostFormData>({
    label: host?.label ?? '',
    hostname: host?.hostname ?? '',
    port: host?.port != null ? String(host.port) : '',
    username: host?.username ?? '',
    password: host?.password ?? '',
    authMethod: initialAuth,
    identityId: host?.identity_id ?? '',
    keyId: host?.key_id ?? '',
    groupId: host?.group_id ?? '',
    tagIds: hostTagIds,
    colour: host?.colour ?? null,
    osType: host?.os_type ?? '',
    keepaliveInterval:
      host?.keepalive_interval != null ? String(host.keepalive_interval) : '60',
    compression: host?.compression ?? false,
    notes: host?.notes ?? '',
  });

  const [errors, setErrors] = useState<Errors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === form.groupId) ?? null,
    [groups, form.groupId],
  );

  const inheritedPort = selectedGroup?.default_port;
  const inheritedUsername = selectedGroup?.default_username;
  const inheritedIdentityId = selectedGroup?.default_identity_id;

  const set = (key: keyof HostFormData, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = (): boolean => {
    const e: Errors = {};
    if (!form.label.trim()) e.label = 'Label is required';
    if (!form.hostname.trim()) e.hostname = 'Hostname is required';
    if (!form.username.trim() && !inheritedUsername) {
      e.username = 'Username is required';
    }
    const portNum = form.port ? Number(form.port) : (inheritedPort ?? 22);
    if (form.port && (isNaN(portNum) || portNum < 1 || portNum > 65535)) {
      e.port = 'Port must be 1-65535';
    }
    const ka = Number(form.keepaliveInterval);
    if (form.keepaliveInterval && (isNaN(ka) || ka < 0)) {
      e.keepaliveInterval = 'Must be a non-negative number';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleTestConnection = async () => {
    if (!validate()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const portVal = form.port ? Number(form.port) : (inheritedPort ?? 22);
      const usernameVal = form.username || inheritedUsername || 'root';

      // Resolve the key (if any) that should be used for this test
      let keyId: string | undefined;
      if (form.authMethod === 'key') {
        keyId = form.keyId || undefined;
      } else if (form.authMethod === 'identity') {
        const identityId = form.identityId || inheritedIdentityId || undefined;
        const identity = identities.find((i) => i.id === identityId);
        keyId = identity?.key_id ?? undefined;
      }

      await window.nexus.ssh.testConnect({
        hostname: form.hostname,
        port: portVal,
        username: usernameVal,
        password: form.authMethod === 'password' ? form.password : undefined,
        keyId,
      });
      setTestResult('Connection successful');
    } catch (err) {
      setTestResult(`Connection failed: ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const portVal = form.port ? Number(form.port) : (inheritedPort ?? 22);

      const vaultId = host?.vault_id ?? selectedVaultId;
      if (!vaultId) {
        setSaveError('No vault selected. Please create or unlock a vault first.');
        setSaving(false);
        return;
      }

      const payload = {
        vault_id: vaultId,
        group_id: form.groupId || undefined,
        label: form.label.trim(),
        hostname: form.hostname.trim(),
        port: portVal,
        username: form.username || undefined,
        password: form.authMethod === 'password' ? form.password || undefined : undefined,
        identity_id: form.authMethod === 'identity' ? form.identityId || undefined : undefined,
        key_id: form.authMethod === 'key' ? form.keyId || undefined : undefined,
        keepalive_interval: Number(form.keepaliveInterval) || 60,
        compression: form.compression,
        os_type: (form.osType as OSType) || undefined,
        notes: form.notes || undefined,
        colour: form.colour,
      };
      if (isEditing) {
        await updateHost(host!.id, payload);
      } else {
        await addHost(payload);
      }
      onClose();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    try {
      const tag = await addTag({ name, colour: null });
      set('tagIds', [...form.tagIds, tag.id]);
      setNewTagName('');
    } catch (err) {
      addNotification('error', (err as Error).message);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? `Edit Host — ${host!.label}` : 'New Host'}
      maxWidth="max-w-md"
    >
      <div className="flex flex-col" style={{ maxHeight: '70vh' }}>
        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto scrollbar-hidden">
          <div className="flex flex-col gap-4">
            {/* Save error banner */}
            {saveError && (
              <div className="rounded bg-[rgba(247,118,142,0.15)] px-3 py-2 text-xs text-[var(--color-danger)]">
                {saveError}
              </div>
            )}

            {/* Test result banner */}
            {testResult && (
              <div
                className="rounded px-3 py-2 text-xs"
                style={{
                  backgroundColor: testResult.startsWith('Connection successful')
                    ? 'rgba(158, 206, 106, 0.15)'
                    : 'rgba(247, 118, 142, 0.15)',
                  color: testResult.startsWith('Connection successful')
                    ? 'var(--color-success)'
                    : 'var(--color-danger)',
                }}
              >
                {testResult}
              </div>
            )}

            {/* Label */}
            <Field label="Label" required error={errors.label}>
              <input
                className="input"
                value={form.label}
                onChange={(e) => set('label', e.target.value)}
                placeholder="My Server"
                autoFocus
              />
            </Field>

            {/* Hostname */}
            <Field label="Hostname" required error={errors.hostname}>
              <input
                className="input"
                value={form.hostname}
                onChange={(e) => set('hostname', e.target.value)}
                placeholder="192.168.1.1 or example.com"
              />
            </Field>

            {/* Port */}
            <Field
              label="Port"
              error={errors.port}
              hint={
                !form.port && inheritedPort != null
                  ? `Inherited from ${selectedGroup!.name}`
                  : undefined
              }
            >
              <input
                className="input"
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => set('port', e.target.value)}
                placeholder={inheritedPort != null ? String(inheritedPort) : '22'}
              />
            </Field>

            {/* Username */}
            <Field
              label="Username"
              required
              error={errors.username}
              hint={
                !form.username && inheritedUsername
                  ? `Inherited from ${selectedGroup!.name}`
                  : undefined
              }
            >
              <input
                className="input"
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
                placeholder={inheritedUsername ?? 'root'}
              />
            </Field>

            {/* Divider */}
            <div className="border-t border-[var(--color-border)]" />

            {/* Authentication */}
            <Field label="Authentication">
              <div className="flex gap-1 rounded-md border border-[var(--color-border)] p-0.5">
                {(['password', 'identity', 'key'] as AuthMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => set('authMethod', m)}
                    className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                      form.authMethod === m
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    {m === 'password' ? 'Password' : m === 'identity' ? 'Identity' : 'SSH Key'}
                  </button>
                ))}
              </div>
            </Field>

            {/* Auth-specific input */}
            {form.authMethod === 'password' && (
              <Field label="Password">
                <div className="relative">
                  <input
                    className="input"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                    placeholder="Enter password"
                    style={{ paddingRight: '48px' }}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </Field>
            )}

            {form.authMethod === 'identity' && (
              <Field label="Identity">
                <select
                  className="input"
                  value={form.identityId}
                  onChange={(e) => set('identityId', e.target.value)}
                >
                  <option value="">
                    {inheritedIdentityId
                      ? `(inherited) ${identities.find((i) => i.id === inheritedIdentityId)?.name ?? ''}`
                      : '-- Select identity --'}
                  </option>
                  {identities.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {form.authMethod === 'key' && (
              <Field label="SSH Key">
                <select
                  className="input"
                  value={form.keyId}
                  onChange={(e) => set('keyId', e.target.value)}
                >
                  <option value="">-- Select key --</option>
                  {keys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} ({k.key_type})
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {/* Divider */}
            <div className="border-t border-[var(--color-border)]" />

            {/* Group */}
            <Field label="Group">
              <select
                className="input"
                value={form.groupId}
                onChange={(e) => set('groupId', e.target.value)}
              >
                <option value="">None</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.icon ? `${g.icon} ` : ''}{g.name}
                  </option>
                ))}
              </select>
            </Field>

            {/* Tags */}
            <Field label="Tags">
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => {
                  const selected = form.tagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() =>
                        set(
                          'tagIds',
                          selected
                            ? form.tagIds.filter((id) => id !== t.id)
                            : [...form.tagIds, t.id],
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors"
                      style={{
                        borderColor: selected
                          ? t.colour ?? 'var(--color-accent)'
                          : 'var(--color-border)',
                        backgroundColor: selected
                          ? `${t.colour ?? 'var(--color-accent)'}22`
                          : 'transparent',
                        color: selected
                          ? t.colour ?? 'var(--color-accent)'
                          : 'var(--color-text-muted)',
                      }}
                    >
                      {t.colour && (
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: t.colour }}
                        />
                      )}
                      {t.name}
                    </button>
                  );
                })}
              </div>
              <input
                className="input w-full text-[11px]"
                style={{ padding: '4px 8px', marginTop: '6px' }}
                placeholder="Type a tag name and press Enter..."
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
              />
            </Field>

            {/* Colour */}
            <Field label="Tab Colour">
              <ColourPicker value={form.colour} onChange={(c) => set('colour', c)} />
            </Field>

            {/* Advanced accordion */}
            <Accordion label="Advanced Options">
              <div className="flex flex-col gap-4">
                <Field label="OS Type">
                  <select
                    className="input"
                    value={form.osType}
                    onChange={(e) => set('osType', e.target.value)}
                  >
                    <option value="">Auto-detect</option>
                    {OS_TYPES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Keepalive Interval (seconds)" error={errors.keepaliveInterval}>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={form.keepaliveInterval}
                    onChange={(e) => set('keepaliveInterval', e.target.value)}
                    placeholder="60"
                  />
                </Field>

                <Field label="Compression">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.compression}
                      onChange={(e) => set('compression', e.target.checked)}
                      className="accent-[var(--color-accent)]"
                    />
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      Enable compression
                    </span>
                  </label>
                </Field>
              </div>
            </Accordion>

            {/* Notes */}
            <Field label="Notes">
              <textarea
                className="input resize-y"
                rows={2}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Notes about this host..."
              />
            </Field>
          </div>
        </div>

        {/* Fixed footer */}
        <div className="mt-4 flex items-center gap-2 border-t border-[var(--color-border)] pt-4">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing || saving}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)]"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-tertiary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Host'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

// ── Accordion component ─────────────────────────────────────

function Accordion({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md border border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
      >
        {label}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="3,4.5 6,7.5 9,4.5" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-[var(--color-border)] px-3 py-3">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Inline field component ──────────────────────────────────

function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
        {label}
        {required && <span className="ml-0.5 text-[var(--color-danger)]">*</span>}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-[11px] text-[var(--color-danger)]">{error}</p>
      )}
      {hint && !error && (
        <p className="mt-1 text-[11px] text-[var(--color-text-muted)] italic">{hint}</p>
      )}
    </div>
  );
}
