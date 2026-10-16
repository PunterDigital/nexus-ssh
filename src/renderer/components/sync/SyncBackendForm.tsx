import React from 'react';
import { FolderOpen } from 'lucide-react';
import { Button, Field, Input, PasswordInput, Select } from '../ui';
import type { BackendConfig, SyncBackendType } from '../../../shared/types';

// ============================================================
// SyncBackendForm — the connection fields of the chosen sync backend (design system: #2367)
// ============================================================

interface SyncBackendFormProps {
  backendType: SyncBackendType;
  config: BackendConfig;
  onChange: (config: BackendConfig) => void;
  sshKeys?: Array<{ id: string; name: string }>;
}

/** Host + port on one row: the port keeps a fixed width and the host takes the rest. */
function HostPortRow({
  config,
  update,
  hostPlaceholder,
  defaultPort,
}: {
  config: BackendConfig;
  update: (patch: Partial<BackendConfig>) => void;
  hostPlaceholder: string;
  defaultPort: number;
}) {
  return (
    <div className="flex items-start gap-3">
      <Field label="Host" required className="min-w-0 flex-1">
        <Input
          code
          type="text"
          placeholder={hostPlaceholder}
          spellCheck={false}
          value={config.host || ''}
          onChange={(e) => update({ host: e.target.value })}
        />
      </Field>
      <Field label="Port" className="w-28 shrink-0">
        <Input
          type="number"
          min={1}
          max={65535}
          placeholder={String(defaultPort)}
          value={config.port ?? defaultPort}
          onChange={(e) => update({ port: Number(e.target.value) || defaultPort })}
        />
      </Field>
    </div>
  );
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
        <div className="flex flex-col gap-4">
          <HostPortRow config={config} update={update} hostPlaceholder="server.example.com" defaultPort={22} />

          <Field label="Username" required>
            <Input
              type="text"
              placeholder="username"
              spellCheck={false}
              value={config.username || ''}
              onChange={(e) => update({ username: e.target.value })}
            />
          </Field>

          <Field label="Password" hint={sshKeys.length > 0 ? 'Leave empty to sign in with an SSH key.' : undefined}>
            <PasswordInput
              placeholder="Password (optional if using key)"
              value={config.password || ''}
              onChange={(e) => update({ password: e.target.value })}
            />
          </Field>

          {sshKeys.length > 0 && (
            <Field label="SSH key">
              <Select
                value={config.privateKeyId || ''}
                onChange={(e) => update({ privateKeyId: e.target.value || undefined })}
                options={[
                  { value: '', label: 'No SSH key (use password)' },
                  ...sshKeys.map((k) => ({ value: k.id, label: k.name })),
                ]}
              />
            </Field>
          )}

          <Field label="Remote path" required hint="Folder on the server. Created on the first push.">
            <Input
              code
              type="text"
              placeholder="/home/user/nexus-sync"
              spellCheck={false}
              value={config.remotePath || ''}
              onChange={(e) => update({ remotePath: e.target.value })}
            />
          </Field>
        </div>
      );

    case 'ftp':
      return (
        <div className="flex flex-col gap-4">
          <HostPortRow config={config} update={update} hostPlaceholder="ftp.example.com" defaultPort={21} />

          <Field label="Username" required>
            <Input
              type="text"
              placeholder="username"
              spellCheck={false}
              value={config.username || ''}
              onChange={(e) => update({ username: e.target.value })}
            />
          </Field>

          <Field label="Password">
            <PasswordInput
              placeholder="password"
              value={config.password || ''}
              onChange={(e) => update({ password: e.target.value })}
            />
          </Field>

          <Field label="Remote path" required hint="Folder on the server. Created on the first push.">
            <Input
              code
              type="text"
              placeholder="/sync/nexus"
              spellCheck={false}
              value={config.remotePath || ''}
              onChange={(e) => update({ remotePath: e.target.value })}
            />
          </Field>
        </div>
      );

    case 's3':
      return (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bucket" required className="min-w-0">
              <Input
                code
                type="text"
                placeholder="my-nexus-bucket"
                spellCheck={false}
                value={config.bucket || ''}
                onChange={(e) => update({ bucket: e.target.value })}
              />
            </Field>
            <Field label="Region" required className="min-w-0">
              <Input
                code
                type="text"
                placeholder="us-east-1"
                spellCheck={false}
                value={config.region || ''}
                onChange={(e) => update({ region: e.target.value })}
              />
            </Field>
          </div>

          <Field label="Access key ID" required>
            <Input
              code
              type="text"
              placeholder="AKIA..."
              spellCheck={false}
              autoComplete="off"
              value={config.accessKeyId || ''}
              onChange={(e) => update({ accessKeyId: e.target.value })}
            />
          </Field>

          <Field label="Secret access key" required>
            <PasswordInput
              code
              placeholder="Secret access key"
              value={config.secretAccessKey || ''}
              onChange={(e) => update({ secretAccessKey: e.target.value })}
            />
          </Field>

          <Field label="Prefix" hint="Optional path prefix within the bucket.">
            <Input
              code
              type="text"
              placeholder="nexus/"
              spellCheck={false}
              value={config.prefix || ''}
              onChange={(e) => update({ prefix: e.target.value })}
            />
          </Field>

          <Field label="Custom endpoint" hint="Optional. For MinIO, Backblaze B2, Cloudflare R2, etc.">
            <Input
              code
              type="text"
              placeholder="https://s3.example.com"
              spellCheck={false}
              value={config.endpoint || ''}
              onChange={(e) => update({ endpoint: e.target.value })}
            />
          </Field>
        </div>
      );

    case 'filesystem':
      return (
        <Field
          label="Directory path"
          required
          hint="A local, USB or network folder. Point it at a Dropbox / OneDrive folder to sync through them."
        >
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Input
                code
                type="text"
                placeholder="/path/to/sync/directory"
                spellCheck={false}
                value={config.directoryPath || ''}
                onChange={(e) => update({ directoryPath: e.target.value })}
              />
            </div>
            <Button
              icon={FolderOpen}
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
            >
              Browse
            </Button>
          </div>
        </Field>
      );

    default:
      return <p className="text-body-sm text-fg-muted">Select a backend type to configure.</p>;
  }
};
