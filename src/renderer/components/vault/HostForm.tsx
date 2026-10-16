import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Circle, CircleAlert, CircleCheck, PlugZap } from 'lucide-react';
import { ColourPicker } from '../common/ColourPicker';
import { Icon } from '../common/Icon';
import { Button, Dialog, Field, Input, PasswordInput, Select, Textarea, cx } from '../ui';
import type { SelectOption } from '../ui';
import { useVaultStore } from '../../stores/vault-store';
import { useUIStore } from '../../stores/ui-store';
import type { Host, OSType, Tag } from '../../../shared/types';

// ============================================================
// HostForm — create / edit a host (design system: #2366)
//
// One scrolling form in a Dialog, in headed sections (Connection, Authentication, Details) with
// the rarely used settings behind an "Advanced" disclosure. The Dialog body scrolls and its
// footer (Test Connection, Cancel, Create Host / Save Changes) stays visible at 900 x 600.
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

type Errors = Partial<Record<keyof HostFormData, string>>;

export interface HostFormProps {
  open: boolean;
  onClose: () => void;
  host?: Host;
  /** Tags already on the host. When editing without it, the form loads them itself. */
  hostTagIds?: string[];
}

const OS_OPTIONS: SelectOption[] = [
  { value: '', label: 'Auto-detect' },
  { value: 'linux', label: 'Linux' },
  { value: 'windows', label: 'Windows' },
  { value: 'macos', label: 'macOS' },
  { value: 'freebsd', label: 'FreeBSD' },
  { value: 'other', label: 'Other' },
];

const AUTH_OPTIONS: SelectOption[] = [
  { value: 'password', label: 'Password' },
  { value: 'identity', label: 'Identity' },
  { value: 'key', label: 'SSH key' },
];

const ADVANCED_FIELDS: (keyof HostFormData)[] = ['osType', 'keepaliveInterval', 'compression'];

/** Port as typed: whole number 1-65535. */
const isValidPort = (value: string) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;

/**
 * Mounted only while open, so every time the dialog opens it starts from the host (or empty),
 * not from whatever was typed the last time.
 */
export function HostForm(props: HostFormProps): React.ReactElement | null {
  if (!props.open) return null;
  return <HostFormDialog {...props} />;
}

function HostFormDialog({ onClose, host, hostTagIds }: HostFormProps): React.ReactElement {
  const groups = useVaultStore((s) => s.groups);
  const identities = useVaultStore((s) => s.identities);
  const keys = useVaultStore((s) => s.keys);
  const tags = useVaultStore((s) => s.tags);
  const addHost = useVaultStore((s) => s.addHost);
  const updateHost = useVaultStore((s) => s.updateHost);
  const addTag = useVaultStore((s) => s.addTag);
  const selectedVaultId = useVaultStore((s) => s.selectedVaultId);
  const addNotification = useUIStore((s) => s.addNotification);

  const isEditing = !!host;
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);

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
    tagIds: hostTagIds ?? [],
    colour: host?.colour ?? null,
    osType: host?.os_type ?? '',
    keepaliveInterval: host?.keepalive_interval != null ? String(host.keepalive_interval) : '60',
    compression: host?.compression ?? false,
    notes: host?.notes ?? '',
  });

  const [errors, setErrors] = useState<Errors>({});
  // Bumped on each failed submit: focuses the first invalid field once it has rendered.
  const [invalidSubmits, setInvalidSubmits] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');
  const tagsTouched = useRef(false);

  // Editing: load the host's tags unless the caller passed them.
  useEffect(() => {
    if (!host || hostTagIds) return;
    let cancelled = false;
    window.nexus.tags
      .getHostTags(host.id)
      .then((current) => {
        if (cancelled || tagsTouched.current) return;
        setForm((prev) => ({ ...prev, tagIds: (current as Tag[]).map((t) => t.id) }));
      })
      .catch(() => {
        // No tags shown; saving keeps whatever the user picks.
      });
    return () => {
      cancelled = true;
    };
  }, [host, hostTagIds]);

  useEffect(() => {
    if (invalidSubmits === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [invalidSubmits]);

  useEffect(() => {
    if (testResult || saveError) bannerRef.current?.scrollIntoView({ block: 'nearest' });
  }, [testResult, saveError]);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === form.groupId) ?? null,
    [groups, form.groupId],
  );

  const inheritedPort = selectedGroup?.default_port ?? null;
  const inheritedUsername = selectedGroup?.default_username ?? null;
  const inheritedIdentityId = selectedGroup?.default_identity_id ?? null;
  const inheritedFrom = selectedGroup ? `Inherited from ${selectedGroup.name}` : undefined;

  const set = <K extends keyof HostFormData>(key: K, value: HostFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = (): boolean => {
    const e: Errors = {};
    if (!form.label.trim()) e.label = 'Label is required';
    const hostname = form.hostname.trim();
    if (!hostname) e.hostname = 'Hostname is required';
    else if (/\s/.test(hostname)) e.hostname = 'Hostname can’t contain spaces';
    if (form.port.trim() && !isValidPort(form.port.trim())) {
      e.port = 'Port must be between 1 and 65535';
    }
    if (!form.username.trim() && !inheritedUsername) {
      e.username = 'Username is required (or pick a group with a default username)';
    }
    const keepalive = form.keepaliveInterval.trim();
    if (keepalive && !/^\d+$/.test(keepalive)) {
      e.keepaliveInterval = 'Keepalive interval must be a whole number of seconds (0 or more)';
    }
    setErrors(e);
    const fields = Object.keys(e) as (keyof HostFormData)[];
    if (fields.length === 0) return true;
    if (fields.some((f) => ADVANCED_FIELDS.includes(f))) setAdvancedOpen(true);
    setInvalidSubmits((n) => n + 1);
    return false;
  };

  const portValue = () => (form.port.trim() ? Number(form.port.trim()) : (inheritedPort ?? 22));

  const handleTestConnection = async () => {
    if (!validate()) return;
    setTesting(true);
    setTestResult(null);
    try {
      // Resolve the key (if any) that should be used for this test
      let keyId: string | undefined;
      if (form.authMethod === 'key') {
        keyId = form.keyId || undefined;
      } else if (form.authMethod === 'identity') {
        const identityId = form.identityId || inheritedIdentityId || undefined;
        keyId = identities.find((i) => i.id === identityId)?.key_id ?? undefined;
      }

      await window.nexus.ssh.testConnect({
        hostname: form.hostname.trim(),
        port: portValue(),
        username: form.username.trim() || inheritedUsername || 'root',
        password: form.authMethod === 'password' ? form.password : undefined,
        keyId,
      });
      setTestResult({ ok: true, message: 'Connection successful' });
    } catch (err) {
      setTestResult({ ok: false, message: `Connection failed: ${(err as Error).message}` });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!validate()) return;
    const vaultId = host?.vault_id ?? selectedVaultId;
    if (!vaultId) {
      setSaveError('No vault is open. Unlock or create a vault first.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        vault_id: vaultId,
        group_id: form.groupId || null,
        label: form.label.trim(),
        hostname: form.hostname.trim(),
        port: portValue(),
        username: form.username.trim() || null,
        password: form.authMethod === 'password' ? form.password || null : null,
        identity_id: form.authMethod === 'identity' ? form.identityId || null : null,
        key_id: form.authMethod === 'key' ? form.keyId || null : null,
        keepalive_interval: Number(form.keepaliveInterval) || 60,
        compression: form.compression,
        os_type: form.osType || null,
        notes: form.notes || null,
        colour: form.colour,
      };
      let hostId: string;
      if (host) {
        await updateHost(host.id, payload);
        hostId = host.id;
      } else {
        hostId = (await addHost({ ...payload, last_connected: null })).id;
      }
      if (host || form.tagIds.length > 0) {
        await window.nexus.tags.setHostTags(hostId, form.tagIds);
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
    const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    try {
      const tag = existing ?? (await addTag({ name, colour: null }));
      tagsTouched.current = true;
      if (!form.tagIds.includes(tag.id)) set('tagIds', [...form.tagIds, tag.id]);
      setNewTagName('');
    } catch (err) {
      addNotification('error', (err as Error).message);
    }
  };

  const toggleTag = (id: string) => {
    tagsTouched.current = true;
    set('tagIds', form.tagIds.includes(id) ? form.tagIds.filter((t) => t !== id) : [...form.tagIds, id]);
  };

  const groupOptions: SelectOption[] = [
    { value: '', label: 'None' },
    ...groups.map((g) => ({ value: g.id, label: `${g.icon ? `${g.icon} ` : ''}${g.name}` })),
  ];

  const inheritedIdentityName = inheritedIdentityId
    ? identities.find((i) => i.id === inheritedIdentityId)?.name
    : undefined;
  const identityOptions: SelectOption[] = [
    {
      value: '',
      label: inheritedIdentityName ? `Inherited: ${inheritedIdentityName}` : 'Select an identity',
    },
    ...identities.map((i) => ({ value: i.id, label: i.name })),
  ];
  const keyOptions: SelectOption[] = [
    { value: '', label: 'Select a key' },
    ...keys.map((k) => ({ value: k.id, label: `${k.name} (${k.key_type})` })),
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      title={host ? `Edit ${host.label}` : 'New Host'}
      dismissOnBackdrop={false}
      footer={
        <>
          <Button
            icon={PlugZap}
            onClick={() => void handleTestConnection()}
            loading={testing}
            disabled={saving}
            className="mr-auto"
          >
            Test Connection
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={saving}>
            {isEditing ? 'Save Changes' : 'Create Host'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={formRef}
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        {(saveError || testResult) && (
          <div ref={bannerRef} className="flex flex-col gap-2">
            {saveError && (
              <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-body-sm text-danger">
                <Icon icon={CircleAlert} className="mt-0.5" />
                {saveError}
              </p>
            )}
            {testResult && (
              <p
                role={testResult.ok ? 'status' : 'alert'}
                className={cx(
                  'flex items-start gap-2 rounded-md px-3 py-2 text-body-sm',
                  testResult.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
                )}
              >
                <Icon icon={testResult.ok ? CircleCheck : CircleAlert} className="mt-0.5" />
                {testResult.message}
              </p>
            )}
          </div>
        )}

        <FormSection title="Connection">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Label" required error={errors.label}>
              <Input
                value={form.label}
                onChange={(e) => set('label', e.target.value)}
                placeholder="My Server"
                autoFocus
              />
            </Field>
            <Field label="Group">
              <Select
                value={form.groupId}
                onChange={(e) => set('groupId', e.target.value)}
                options={groupOptions}
              />
            </Field>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Field label="Hostname" required error={errors.hostname} className="col-span-3">
              <Input
                code
                value={form.hostname}
                onChange={(e) => set('hostname', e.target.value)}
                placeholder="192.168.1.1 or example.com"
                spellCheck={false}
                autoCapitalize="off"
              />
            </Field>
            <Field
              label="Port"
              error={errors.port}
              aside={!form.port && inheritedPort != null ? 'Inherited' : undefined}
            >
              <Input
                code
                inputMode="numeric"
                value={form.port}
                onChange={(e) => set('port', e.target.value)}
                placeholder={inheritedPort != null ? String(inheritedPort) : '22'}
              />
            </Field>
          </div>
          <Field
            label="Username"
            required={!inheritedUsername}
            error={errors.username}
            aside={!form.username && inheritedUsername ? inheritedFrom : undefined}
          >
            <Input
              value={form.username}
              onChange={(e) => set('username', e.target.value)}
              placeholder={inheritedUsername ?? 'root'}
              spellCheck={false}
              autoCapitalize="off"
            />
          </Field>
        </FormSection>

        <FormSection title="Authentication">
          <Field label="Method">
            <Select
              value={form.authMethod}
              onChange={(e) => set('authMethod', e.target.value as AuthMethod)}
              options={AUTH_OPTIONS}
            />
          </Field>

          {form.authMethod === 'password' && (
            <Field label="Password" hint="Stored encrypted in this vault.">
              <PasswordInput
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                placeholder="Enter password"
              />
            </Field>
          )}

          {form.authMethod === 'identity' && (
            <Field
              label="Identity"
              aside={!form.identityId && inheritedIdentityName ? inheritedFrom : undefined}
              hint={identities.length === 0 ? 'No identities in this vault yet.' : undefined}
            >
              <Select
                value={form.identityId}
                onChange={(e) => set('identityId', e.target.value)}
                options={identityOptions}
              />
            </Field>
          )}

          {form.authMethod === 'key' && (
            <Field
              label="SSH key"
              hint={keys.length === 0 ? 'No SSH keys yet: add one in the Keychain.' : undefined}
            >
              <Select
                value={form.keyId}
                onChange={(e) => set('keyId', e.target.value)}
                options={keyOptions}
              />
            </Field>
          )}
        </FormSection>

        <FormSection title="Details">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-body-sm font-medium text-fg-secondary">Tags</legend>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => {
                  const selected = form.tagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleTag(t.id)}
                      className={cx(
                        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-body-sm',
                        'transition-colors duration-(--duration-fast) ease-standard focus-ring',
                        selected
                          ? 'border-accent bg-accent-soft text-fg'
                          : 'border-line-strong text-fg-muted hover:bg-surface-hover hover:text-fg',
                      )}
                    >
                      {selected && <Icon icon={Check} size={12} />}
                      {/* The tag's own colour is user data, so it can't be a token. */}
                      {t.colour && <Icon icon={Circle} size={8} fill={t.colour} color={t.colour} />}
                      {t.name}
                    </button>
                  );
                })}
              </div>
            )}
            <Input
              size="sm"
              aria-label="New tag"
              placeholder="Type a tag name and press Enter..."
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleAddTag();
                }
              }}
            />
          </fieldset>

          <fieldset className="flex flex-col">
            <legend className="mb-1.5 text-body-sm font-medium text-fg-secondary">Tab colour</legend>
            <ColourPicker value={form.colour} onChange={(c) => set('colour', c)} />
          </fieldset>

          <Field label="Notes">
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Notes about this host..."
            />
          </Field>
        </FormSection>

        <Disclosure label="Advanced" open={advancedOpen} onToggle={() => setAdvancedOpen((v) => !v)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="OS type">
              <Select
                value={form.osType}
                onChange={(e) => set('osType', e.target.value as OSType | '')}
                options={OS_OPTIONS}
              />
            </Field>
            <Field
              label="Keepalive interval"
              error={errors.keepaliveInterval}
              hint="Seconds between keepalive packets."
            >
              <Input
                code
                inputMode="numeric"
                value={form.keepaliveInterval}
                onChange={(e) => set('keepaliveInterval', e.target.value)}
                placeholder="60"
              />
            </Field>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-body text-fg">
            <input
              type="checkbox"
              checked={form.compression}
              onChange={(e) => set('compression', e.target.checked)}
              className="size-4 shrink-0 cursor-pointer accent-accent focus-ring"
            />
            Enable compression
          </label>
        </Disclosure>
      </form>
    </Dialog>
  );
}

/** A titled group of fields inside the form. */
function FormSection({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-body font-semibold text-fg">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Collapsible section (closed by default) for settings most hosts never change. */
function Disclosure({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const id = useId();
  return (
    <section className="rounded-lg border border-line">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className={cx(
            'flex h-9 w-full items-center justify-between gap-2 rounded-lg px-3 text-body font-semibold text-fg',
            'transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-hover focus-ring-inset',
          )}
        >
          {label}
          <Icon
            icon={ChevronDown}
            className={cx(
              'text-fg-muted transition-transform duration-(--duration-fast) ease-standard',
              open && 'rotate-180',
            )}
          />
        </button>
      </h3>
      {open && (
        <div id={id} className="flex flex-col gap-3 border-t border-line p-3">
          {children}
        </div>
      )}
    </section>
  );
}
