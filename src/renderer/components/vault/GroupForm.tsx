import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { FormField } from '../common/FormField';
import { useVaultStore } from '../../stores/vault-store';
import { useUIStore } from '../../stores/ui-store';
import type { Group } from '../../../shared/types';

// ============================================================
// GroupForm — Create / Edit group, shown inside a Modal
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

interface Errors {
  [key: string]: string | undefined;
}

export interface GroupFormProps {
  open: boolean;
  onClose: () => void;
  /** Pass an existing group to enter edit mode */
  group?: Group;
}

export const GroupForm: React.FC<GroupFormProps> = ({ open, onClose, group }) => {
  const { groups, identities, addGroup, updateGroup, selectedVaultId } =
    useVaultStore();
  const { addNotification } = useUIStore();

  const isEditing = !!group;

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
  const [saving, setSaving] = useState(false);

  const set = (key: keyof GroupFormData, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = (): boolean => {
    const e: Errors = {};
    if (!form.name.trim()) e.name = 'Name is required';

    const portNum = Number(form.defaultPort);
    if (form.defaultPort && (isNaN(portNum) || portNum < 1 || portNum > 65535)) {
      e.defaultPort = 'Port must be 1-65535';
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // Exclude current group from parent dropdown to prevent cycles
  const parentOptions = groups.filter((g) => g.id !== group?.id);

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
        default_port: form.defaultPort ? Number(form.defaultPort) : null,
        default_username: form.defaultUsername.trim() || null,
        default_identity_id: form.defaultIdentityId || null,
      };

      if (isEditing) {
        await updateGroup(group!.id, payload);
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
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? `Edit Group: ${group!.name}` : 'New Group'}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Name + Icon */}
        <div className="grid grid-cols-[1fr_80px] gap-3">
          <FormField label="Name" required error={errors.name}>
            <input
              className="input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Production Servers"
            />
          </FormField>

          <FormField label="Icon" helperText="Emoji or text">
            <input
              className="input text-center"
              value={form.icon}
              onChange={(e) => set('icon', e.target.value)}
              placeholder="📁"
              maxLength={4}
            />
          </FormField>
        </div>

        {/* Description */}
        <FormField label="Description">
          <textarea
            className="input resize-y"
            rows={2}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Optional description..."
          />
        </FormField>

        {/* Parent group */}
        <FormField label="Parent Group">
          <select
            className="input"
            value={form.parentId}
            onChange={(e) => set('parentId', e.target.value)}
          >
            <option value="">None (top-level)</option>
            {parentOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.icon ? `${g.icon} ` : ''}{g.name}
              </option>
            ))}
          </select>
        </FormField>

        {/* Defaults */}
        <div
          className="border rounded p-3 flex flex-col gap-3"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <span
            className="text-[11px] font-medium uppercase tracking-wider"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Group Defaults (inherited by hosts)
          </span>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Default Port" error={errors.defaultPort}>
              <input
                className="input"
                type="number"
                min={1}
                max={65535}
                value={form.defaultPort}
                onChange={(e) => set('defaultPort', e.target.value)}
                placeholder="22"
              />
            </FormField>

            <FormField label="Default Username">
              <input
                className="input"
                value={form.defaultUsername}
                onChange={(e) => set('defaultUsername', e.target.value)}
                placeholder="root"
              />
            </FormField>
          </div>

          <FormField label="Default Identity">
            <select
              className="input"
              value={form.defaultIdentityId}
              onChange={(e) => set('defaultIdentityId', e.target.value)}
            >
              <option value="">None</option>
              {identities.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </div>
    </Modal>
  );
};
