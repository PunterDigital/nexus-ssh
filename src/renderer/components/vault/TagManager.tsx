import React, { useState } from 'react';
import { ColourPicker } from '../common/ColourPicker';
import { FormField } from '../common/FormField';
import { useVaultStore } from '../../stores/vault-store';
import { useUIStore } from '../../stores/ui-store';

// ============================================================
// TagManager — Inline tag list with create / edit / delete
// ============================================================

export const TagManager: React.FC = () => {
  const { tags, addTag, updateTag, deleteTag } = useVaultStore();
  const { addNotification } = useUIStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColour, setEditColour] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // New tag state
  const [newName, setNewName] = useState('');
  const [newColour, setNewColour] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  // ---------- edit ----------

  const startEdit = (id: string) => {
    const tag = tags.find((t) => t.id === id);
    if (!tag) return;
    setEditingId(id);
    setEditName(tag.name);
    setEditColour(tag.colour);
    setConfirmDeleteId(null);
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    try {
      await updateTag(editingId, { name: editName.trim(), colour: editColour });
      addNotification('success', 'Tag updated');
      setEditingId(null);
    } catch (err) {
      addNotification('error', (err as Error).message);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  // ---------- delete ----------

  const handleDelete = async (id: string) => {
    try {
      await deleteTag(id);
      addNotification('success', 'Tag deleted');
      setConfirmDeleteId(null);
    } catch (err) {
      addNotification('error', (err as Error).message);
    }
  };

  // ---------- create ----------

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await addTag({ name: newName.trim(), colour: newColour });
      addNotification('success', `Tag "${newName.trim()}" created`);
      setNewName('');
      setNewColour(null);
      setShowNewForm(false);
    } catch (err) {
      addNotification('error', (err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-semibold"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Tags
        </span>
        <button
          type="button"
          className="btn btn-ghost text-[11px]"
          onClick={() => setShowNewForm(!showNewForm)}
        >
          {showNewForm ? 'Cancel' : '+ New Tag'}
        </button>
      </div>

      {/* Create new tag form */}
      {showNewForm && (
        <div
          className="border rounded p-3 flex flex-col gap-3"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <FormField label="Tag Name" required>
            <input
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. production"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCreate();
                }
              }}
            />
          </FormField>
          <FormField label="Colour">
            <ColourPicker value={newColour} onChange={setNewColour} />
          </FormField>
          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-primary text-[11px]"
              onClick={handleCreate}
              disabled={!newName.trim()}
            >
              Create Tag
            </button>
          </div>
        </div>
      )}

      {/* Existing tags list */}
      {tags.length === 0 && !showNewForm && (
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          No tags yet.
        </span>
      )}

      <div className="flex flex-col gap-1">
        {tags.map((tag) => (
          <div key={tag.id}>
            {editingId === tag.id ? (
              /* Inline edit form */
              <div
                className="border rounded p-3 flex flex-col gap-3"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <FormField label="Name" required>
                  <input
                    className="input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        saveEdit();
                      }
                      if (e.key === 'Escape') cancelEdit();
                    }}
                    autoFocus
                  />
                </FormField>
                <FormField label="Colour">
                  <ColourPicker value={editColour} onChange={setEditColour} />
                </FormField>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn btn-ghost text-[11px]" onClick={cancelEdit}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary text-[11px]"
                    onClick={saveEdit}
                    disabled={!editName.trim()}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              /* Tag row */
              <div
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--color-bg-tertiary)] transition-colors group"
              >
                {/* Colour dot */}
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0 border"
                  style={{
                    backgroundColor: tag.colour ?? 'transparent',
                    borderColor: tag.colour ?? 'var(--color-border)',
                  }}
                />

                {/* Name */}
                <span
                  className="flex-1 text-xs"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {tag.name}
                </span>

                {/* Actions (visible on hover) */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    className="btn btn-ghost text-[10px] py-0 px-1"
                    onClick={() => startEdit(tag.id)}
                  >
                    Edit
                  </button>

                  {confirmDeleteId === tag.id ? (
                    <>
                      <span className="text-[10px]" style={{ color: 'var(--color-danger)' }}>
                        Delete?
                      </span>
                      <button
                        type="button"
                        className="btn btn-danger text-[10px] py-0 px-1"
                        onClick={() => handleDelete(tag.id)}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost text-[10px] py-0 px-1"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost text-[10px] py-0 px-1"
                      style={{ color: 'var(--color-danger)' }}
                      onClick={() => setConfirmDeleteId(tag.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
