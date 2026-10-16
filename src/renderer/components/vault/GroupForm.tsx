import React, { useEffect, useId, useRef, useState } from 'react';
import { Button, Dialog, Field, Input, Select, Textarea } from '../ui';
import type { SelectOption } from '../ui';
import { useVaultStore } from '../../stores/vault-store';
import { useUIStore } from '../../stores/ui-store';
import type { Group } from '../../../shared/types';

// ============================================================
// GroupForm — create / edit a group (design system: #2366)
// ============================================================

interface GroupFormData {
  name: string;
  description: string;
  icon: string;
  parentId: string;
  defaultPort: string;
  defaultUsername: string;
  defaultIdentityId: string;
}

type Errors = Partial<Record<keyof GroupFormData, string>>;

export interface GroupFormProps {
  open: boolean;
  onClose: () => void;
  /** Pass an existing group to enter edit mode */
  group?: Group;
}

/** Mounted only while open, so the form starts fresh each time the dialog opens. */
export function GroupForm(props: GroupFormProps): React.ReactElement | null {
  if (!props.open) return null;
  return <GroupFormDialog {...props} />;
}

function GroupFormDialog({ onClose, group }: GroupFormProps): React.ReactElement {
  const groups = useVaultStore((s) => s.groups);
  const identities = useVaultStore((s) => s.identities);
  const addGroup = useVaultStore((s) => s.addGroup);
  const updateGroup = useVaultStore((s) => s.updateGroup);
  const selectedVaultId = useVaultStore((s) => s.selectedVaultId);
  const addNotification = useUIStore((s) => s.addNotification);

  const formId = useId();
  const defaultsId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  const [form, setForm] = useState<GroupFormData>({
    name: group?.name ?? '',
    description: group?.description ?? '',
    icon: group?.icon ?? '',
    parentId: group?.parent_id ?? '',
    defaultPort: group?.default_port != null ? String(group.default_port) : '',
    defaultUsername: group?.default_username ?? '',
    defaultIdentityId: group?.default_identity_id ?? '',
  });

  const [errors, setErrors] = useState<Errors>({});
  const [invalidSubmits, setInvalidSubmits] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (invalidSubmits === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [invalidSubmits]);

  const set = (key: keyof GroupFormData, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = (): boolean => {
    const e: Errors = {};
    if (!form.name.trim()) e.name = 'Name is required';
    const port = form.defaultPort.trim();
    if (port && !(/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535)) {
      e.defaultPort = 'Port must be between 1 and 65535';
    }
    setErrors(e);
    if (Object.keys(e).length === 0) return true;
    setInvalidSubmits((n) => n + 1);
    return false;
  };

  // Exclude the group itself from the parent list to prevent cycles
  const parentOptions: SelectOption[] = [
    { value: '', label: 'None (top level)' },
    ...groups
      .filter((g) => g.id !== group?.id)
      .map((g) => ({ value: g.id, label: `${g.icon ? `${g.icon} ` : ''}${g.name}` })),
  ];
  const identityOptions: SelectOption[] = [
    { value: '', label: 'None' },
    ...identities.map((i) => ({ value: i.id, label: i.name })),
  ];

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        vault_id: group?.vault_id ?? selectedVaultId ?? '',
        parent_id: form.parentId || null,
        name: form.name.trim(),
        description: form.description.trim() || null,
        icon: form.icon.trim() || null,
        default_port: form.defaultPort.trim() ? Number(form.defaultPort.trim()) : null,
        default_username: form.defaultUsername.trim() || null,
        default_identity_id: form.defaultIdentityId || null,
      };

      if (group) {
        await updateGroup(group.id, payload);
        addNotification('success', `Group "${payload.name}" updated`);
      } else {
        await addGroup(payload);
        addNotification('success', `Group "${payload.name}" created`);
      }
      onClose();
    } catch (err) {
      addNotification('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={group ? `Edit ${group.name}` : 'New Group'}
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={saving}>
            {group ? 'Save Changes' : 'Create Group'}
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
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-4 gap-3">
            <Field label="Name" required error={errors.name} className="col-span-3">
              <Input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Production Servers"
                autoFocus
              />
            </Field>
            <Field label="Icon" hint="Emoji or text">
              <Input
                value={form.icon}
                onChange={(e) => set('icon', e.target.value)}
                placeholder="📁"
                maxLength={4}
                className="text-center"
              />
            </Field>
          </div>

          <Field label="Description">
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Optional description..."
            />
          </Field>

          <Field label="Parent group">
            <Select
              value={form.parentId}
              onChange={(e) => set('parentId', e.target.value)}
              options={parentOptions}
            />
          </Field>
        </div>

        <section aria-labelledby={defaultsId} className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 id={defaultsId} className="text-body font-semibold text-fg">
              Defaults for hosts
            </h3>
            <p className="text-body-sm text-fg-muted">
              Hosts in this group use these when their own fields are empty.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Default port" error={errors.defaultPort}>
              <Input
                code
                inputMode="numeric"
                value={form.defaultPort}
                onChange={(e) => set('defaultPort', e.target.value)}
                placeholder="22"
              />
            </Field>
            <Field label="Default username">
              <Input
                value={form.defaultUsername}
                onChange={(e) => set('defaultUsername', e.target.value)}
                placeholder="root"
                spellCheck={false}
                autoCapitalize="off"
              />
            </Field>
          </div>

          <Field label="Default identity">
            <Select
              value={form.defaultIdentityId}
              onChange={(e) => set('defaultIdentityId', e.target.value)}
              options={identityOptions}
            />
          </Field>
        </section>
      </form>
    </Dialog>
  );
}
