import React from 'react';
import { FormField } from '../common/FormField';
import type { BackendConfig, SyncBackendType } from '../../../shared/types';

// ============================================================
// SyncBackendForm — Dynamic form based on selected backend type
// ============================================================

interface SyncBackendFormProps {
  backendType: SyncBackendType;
  config: BackendConfig;
  onChange: (config: BackendConfig) => void;
  sshKeys?: Array<{ id: string; name: string }>;
}

export const SyncBackendForm: React.FC<SyncBackendFormProps> = ({
  backendType,
  config,
  onChange,
  sshKeys = [],
}) => {
  const update = (patch: Partial<BackendConfig>) => {
    onChange({ ...config, ...patch });
  };

  switch (backendType) {
    case 'sftp':
      return (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <FormField label="Host" required>
              <input
                className="input"
                type="text"
                placeholder="server.example.com"
                value={config.host || ''}
                onChange={(e) => update({ host: e.target.value })}
              />
            </FormField>
            <FormField label="Port">
              <input
                className="input"
                type="number"
                placeholder="22"
                value={config.port ?? 22}
                onChange={(e) => update({ port: Number(e.target.value) || 22 })}
              />
            </FormField>
          </div>

          <FormField label="Username" required>
            <input
              className="input"
              type="text"
              placeholder="username"
              value={config.username || ''}
              onChange={(e) => update({ username: e.target.value })}
            />
          </FormField>

          <FormField label="Authentication">
            <div className="flex flex-col gap-2">
              <input
                className="input"
                type="password"
                placeholder="Password (optional if using key)"
                value={config.password || ''}
                onChange={(e) => update({ password: e.target.value })}
              />
              {sshKeys.length > 0 && (
                <select
                  className="input"
                  value={config.privateKeyId || ''}
                  onChange={(e) => update({ privateKeyId: e.target.value || undefined })}
                >
                  <option value="">No SSH key (use password)</option>
                  {sshKeys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </FormField>

          <FormField label="Remote Path" required>
            <input
              className="input"
              type="text"
              placeholder="/home/user/nexus-sync"
              value={config.remotePath || ''}
              onChange={(e) => update({ remotePath: e.target.value })}
            />
          </FormField>
        </div>
      );

    case 'ftp':
      return (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <FormField label="Host" required>
              <input
                className="input"
                type="text"
                placeholder="ftp.example.com"
                value={config.host || ''}
                onChange={(e) => update({ host: e.target.value })}
              />
            </FormField>
            <FormField label="Port">
              <input
                className="input"
                type="number"
                placeholder="21"
                value={config.port ?? 21}
                onChange={(e) => update({ port: Number(e.target.value) || 21 })}
              />
            </FormField>
          </div>

          <FormField label="Username" required>
            <input
              className="input"
              type="text"
              placeholder="username"
              value={config.username || ''}
              onChange={(e) => update({ username: e.target.value })}
            />
          </FormField>

          <FormField label="Password">
            <input
              className="input"
              type="password"
              placeholder="password"
              value={config.password || ''}
              onChange={(e) => update({ password: e.target.value })}
            />
          </FormField>

          <FormField label="Remote Path" required>
            <input
              className="input"
              type="text"
              placeholder="/sync/nexus"
              value={config.remotePath || ''}
              onChange={(e) => update({ remotePath: e.target.value })}
            />
          </FormField>
        </div>
      );

    case 's3':
      return (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Bucket" required>
              <input
                className="input"
                type="text"
                placeholder="my-nexus-bucket"
                value={config.bucket || ''}
                onChange={(e) => update({ bucket: e.target.value })}
              />
            </FormField>
            <FormField label="Region" required>
              <input
                className="input"
                type="text"
                placeholder="us-east-1"
                value={config.region || ''}
                onChange={(e) => update({ region: e.target.value })}
              />
            </FormField>
          </div>

          <FormField label="Access Key ID" required>
            <input
              className="input"
              type="text"
              placeholder="AKIA..."
              value={config.accessKeyId || ''}
              onChange={(e) => update({ accessKeyId: e.target.value })}
            />
          </FormField>

          <FormField label="Secret Access Key" required>
            <input
              className="input"
              type="password"
              placeholder="Secret access key"
              value={config.secretAccessKey || ''}
              onChange={(e) => update({ secretAccessKey: e.target.value })}
            />
          </FormField>

          <FormField label="Prefix" helperText="Optional path prefix within the bucket.">
            <input
              className="input"
              type="text"
              placeholder="nexus/"
              value={config.prefix || ''}
              onChange={(e) => update({ prefix: e.target.value })}
            />
          </FormField>

          <FormField label="Custom Endpoint" helperText="Optional. For MinIO, Backblaze B2, Cloudflare R2, etc.">
            <input
              className="input"
              type="text"
              placeholder="https://s3.example.com"
              value={config.endpoint || ''}
              onChange={(e) => update({ endpoint: e.target.value })}
            />
          </FormField>
        </div>
      );

    case 'filesystem':
      return (
        <div className="flex flex-col gap-3">
          <FormField label="Directory Path" required>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                type="text"
                placeholder="/path/to/sync/directory"
                value={config.directoryPath || ''}
                onChange={(e) => update({ directoryPath: e.target.value })}
              />
              <button
                className="btn btn-ghost shrink-0"
                style={{ border: '1px solid var(--color-border)' }}
                onClick={async () => {
                  try {
                    const chosen = await window.nexus.fs.pickDirectory();
                    if (chosen) {
                      update({ directoryPath: chosen });
                    }
                  } catch {
                    // ignore cancel / permission errors
                  }
                }}
                type="button"
              >
                Browse
              </button>
            </div>
          </FormField>
        </div>
      );

    default:
      return (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Select a backend type to configure.
        </p>
      );
  }
};
