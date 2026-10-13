import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { FormField } from '../common/FormField';
import { useVaultStore } from '../../stores/vault-store';
import { useUIStore } from '../../stores/ui-store';
import type { Identity } from '../../../shared/types';

// ============================================================
// IdentityForm — Create / Edit identity (reusable credential bundle)
// ============================================================

interface IdentityFormData {
  name: string;
  username: string;
  password: string;
  keyId: string;
}

interface Errors {
  [key: string]: string | undefined;
}

export interface IdentityFormProps {
  open: boolean;
  onClose: () => void;
  identity?: Identity;
}

export const IdentityForm: React.FC<IdentityFormProps> = ({
  open,
  onClose,
  identity,
}) => {
  const { keys, addIdentity, updateIdentity, selectedVaultId } = useVaultStore();
  const { addNotification } = useUIStore();

  const isEditing = !!identity;

  const [form, setForm] = useState<IdentityFormData>({
    name: identity?.name ?? '',
    username: identity?.username ?? '',
    password: identity?.password ?? '',
    keyId: identity?.key_id ?? '',
  });

  const [errors, setErrors] = useState<Errors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof IdentityFormData, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = (): boolean => {
    const e: Errors = {};
    if (!form.name.trim()) e.name = 'Name is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        vault_id: identity?.vault_id ?? selectedVaultId ?? '',
        name: form.name.trim(),
        username: form.username.trim() || null,
        password: form.password || null,
        key_id: form.keyId || null,
      };

      if (isEditing) {
        await updateIdentity(identity!.id, payload);
        addNotification('success', `Identity "${payload.name}" updated`);
      } else {
        await addIdentity(payload);
        addNotification('success', `Identity "${payload.name}" created`);
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
      title={isEditing ? `Edit Identity: ${identity!.name}` : 'New Identity'}
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
        <FormField label="Name" required error={errors.name}>
          <input
            className="input"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Production Deploy Key"
          />
        </FormField>

        <FormField label="Username">
          <input
            className="input"
            value={form.username}
            onChange={(e) => set('username', e.target.value)}
            placeholder="root"
          />
        </FormField>

        <FormField label="Password">
          <div className="relative">
            <input
              className="input pr-16"
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              placeholder="Enter password"
            />
            <button
              type="button"
              className="absolute right-1 top-1/2 -translate-y-1/2 btn btn-ghost text-[10px] py-0.5 px-1.5"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </FormField>

        <FormField label="Linked SSH Key">
          <select
            className="input"
            value={form.keyId}
            onChange={(e) => set('keyId', e.target.value)}
          >
            <option value="">None</option>
            {keys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name} ({k.key_type})
              </option>
            ))}
          </select>
        </FormField>
      </div>
    </Modal>
  );
};
