import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  Copy,
  Download,
  Eye,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  SquareTerminal,
  Trash2,
  Upload,
} from 'lucide-react';
import { BUNDLED_THEMES, applyTheme, getThemeById } from '../../styles/themes';
import { Button, Card, Dialog, EmptyState, Field, IconButton, Input, Menu, PasswordInput, Select, Textarea, Tabs, Toolbar, ToolbarSeparator } from '.';

// Living reference for docs/design-system.md: every token and primitive in every state.
// Open it with the app's URL hash #design-system (dev: http://localhost:5173/#design-system;
// E2E: tests/e2e/design-system.spec.ts). It needs no vault.

const SURFACES = [
  ['surface-sunken', 'bg-surface-sunken'],
  ['surface', 'bg-surface'],
  ['surface-raised', 'bg-surface-raised'],
  ['surface-hover', 'bg-surface-hover'],
  ['surface-pressed', 'bg-surface-pressed'],
] as const;

const SOLIDS = [
  ['accent', 'bg-accent text-on-accent'],
  ['accent-soft', 'bg-accent-soft text-accent'],
  ['danger', 'bg-danger text-on-danger'],
  ['danger-soft', 'bg-danger-soft text-danger'],
  ['success-soft', 'bg-success-soft text-success'],
  ['warning-soft', 'bg-warning-soft text-warning'],
] as const;

const TEXT = [
  ['fg', 'text-fg'],
  ['fg-secondary', 'text-fg-secondary'],
  ['fg-muted', 'text-fg-muted'],
] as const;

const TYPE = [
  ['display · 24/32', 'text-display font-semibold'],
  ['heading · 20/28', 'text-heading font-semibold'],
  ['heading-sm · 16/24', 'text-heading-sm font-semibold'],
  ['body-lg · 14/22', 'text-body-lg'],
  ['body · 13/20', 'text-body'],
  ['body-sm · 12/18', 'text-body-sm'],
  ['caption · 11/16', 'text-caption'],
] as const;

const SPACING = [
  ['1 · 4px', 'w-1'],
  ['2 · 8px', 'w-2'],
  ['3 · 12px', 'w-3'],
  ['4 · 16px', 'w-4'],
  ['6 · 24px', 'w-6'],
  ['8 · 32px', 'w-8'],
  ['12 · 48px', 'w-12'],
] as const;

const RADII = [
  ['sm · 4', 'rounded-sm'],
  ['md · 6', 'rounded-md'],
  ['lg · 8', 'rounded-lg'],
  ['xl · 12', 'rounded-xl'],
  ['full', 'rounded-full'],
] as const;

const SHADOWS = [
  ['raised', 'shadow-raised'],
  ['popover', 'shadow-popover'],
  ['dialog', 'shadow-dialog'],
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`ds-${title}`}>
      <h2 id={`ds-${title}`} className="text-heading-sm font-semibold text-fg">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

export function DesignSystemGallery() {
  const [themeId, setThemeId] = useState('tokyo-night');
  const [tab, setTab] = useState('general');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [lastAction, setLastAction] = useState('none');
  const [host, setHost] = useState('');

  useEffect(() => {
    applyTheme(getThemeById(themeId));
  }, [themeId]);

  return (
    <main className="h-screen overflow-y-auto bg-surface font-ui text-fg">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 p-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-display font-semibold">Nexus design system</h1>
            <p className="mt-1 text-body-lg text-fg-muted">Tokens and primitives. Themes change colours only.</p>
          </div>
          <div className="w-56">
            <Field label="Theme">
              <Select
                value={themeId}
                onChange={(e) => setThemeId(e.target.value)}
                options={BUNDLED_THEMES.map((t) => ({ value: t.id, label: t.name }))}
              />
            </Field>
          </div>
        </header>

        <Section title="Colour">
          <Row>
            {SURFACES.map(([name, cls]) => (
              <div key={name} className={`flex h-16 w-32 items-end rounded-lg border border-line p-2 text-caption text-fg-secondary ${cls}`}>
                {name}
              </div>
            ))}
          </Row>
          <Row>
            {SOLIDS.map(([name, cls]) => (
              <div key={name} className={`flex h-12 w-32 items-center justify-center rounded-lg text-body-sm font-medium ${cls}`}>
                {name}
              </div>
            ))}
          </Row>
          <Row>
            {TEXT.map(([name, cls]) => (
              <span key={name} className={`text-body ${cls}`}>
                {name}: The quick brown fox
              </span>
            ))}
            <span className="rounded-md border border-line px-2 py-1 text-body-sm text-fg-muted">line</span>
            <span className="rounded-md border border-line-strong px-2 py-1 text-body-sm text-fg-muted">line-strong</span>
          </Row>
        </Section>

        <Section title="Type">
          <div className="flex flex-col gap-2">
            {TYPE.map(([name, cls]) => (
              <div key={name} className="flex items-baseline gap-4">
                <span className="w-36 shrink-0 text-caption text-fg-muted">{name}</span>
                <span className={cls}>Connect to production-web-01</span>
              </div>
            ))}
            <div className="flex items-baseline gap-4">
              <span className="w-36 shrink-0 text-caption text-fg-muted">code · body</span>
              <span className="font-code text-body">ssh deploy@10.0.0.12 -p 2222</span>
            </div>
          </div>
        </Section>

        <Section title="Spacing, radii, elevation">
          <div className="flex flex-col gap-2">
            {SPACING.map(([name, cls]) => (
              <div key={name} className="flex items-center gap-4">
                <span className="w-36 shrink-0 text-caption text-fg-muted">{name}</span>
                <div className={`h-3 rounded-sm bg-accent ${cls}`} />
              </div>
            ))}
          </div>
          <Row>
            {RADII.map(([name, cls]) => (
              <div key={name} className={`flex size-16 items-center justify-center border border-line-strong bg-surface-raised text-caption text-fg-muted ${cls}`}>
                {name}
              </div>
            ))}
            {SHADOWS.map(([name, cls]) => (
              <div key={name} className={`flex h-16 w-28 items-center justify-center rounded-lg bg-surface-raised text-caption text-fg-muted ${cls}`}>
                {name}
              </div>
            ))}
          </Row>
        </Section>

        <Section title="Button">
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <Row key={size}>
              <Button variant="primary" size={size} icon={Plus}>
                New Host
              </Button>
              <Button size={size} icon={Upload}>
                Upload
              </Button>
              <Button variant="ghost" size={size}>
                Cancel
              </Button>
              <Button variant="danger" size={size} icon={Trash2}>
                Delete
              </Button>
              <Button variant="primary" size={size} loading>
                Connecting
              </Button>
              <Button size={size} disabled>
                Disabled
              </Button>
            </Row>
          ))}
        </Section>

        <Section title="IconButton and Toolbar">
          <Toolbar label="Remote files" className="w-fit rounded-lg border border-line bg-surface-sunken p-1">
            <IconButton icon={RefreshCw} label="Refresh" size="sm" onClick={() => setLastAction('refresh')} />
            <IconButton icon={Eye} label="Show hidden files" size="sm" pressed={hidden} onClick={() => setHidden((h) => !h)} />
            <ToolbarSeparator />
            <IconButton icon={Upload} label="Upload" size="sm" />
            <IconButton icon={Download} label="Download" size="sm" />
            <IconButton icon={Settings} label="SFTP settings" size="sm" />
          </Toolbar>
          <Row>
            <IconButton icon={Settings} label="Settings (md ghost)" />
            <IconButton icon={Plus} label="Add (md secondary)" variant="secondary" />
            <IconButton icon={Plus} label="Add (md primary)" variant="primary" />
            <IconButton icon={Trash2} label="Delete (lg danger)" variant="danger" size="lg" />
          </Row>
        </Section>

        <Section title="Field, Input and Select">
          <div className="grid max-w-2xl grid-cols-2 gap-4">
            <Field label="Hostname" hint="IP address or DNS name." required>
              <Input placeholder="192.168.1.1 or example.com" code value={host} onChange={(e) => setHost(e.target.value)} />
            </Field>
            <Field label="Port" error="Port must be between 1 and 65535.">
              <Input defaultValue="70000" inputMode="numeric" />
            </Field>
            <Field label="Search">
              <Input leadingIcon={Search} placeholder="Search hosts" />
            </Field>
            <Field label="Authentication" aside="Inherited from Production">
              <Select
                defaultValue="key"
                options={[
                  { value: 'password', label: 'Password' },
                  { value: 'key', label: 'SSH key' },
                  { value: 'agent', label: 'SSH agent' },
                ]}
              />
            </Field>
            <Field label="Disabled">
              <Input disabled defaultValue="read-only" />
            </Field>
            <Field label="Small">
              <Input size="sm" placeholder="Filter" />
            </Field>
            <Field label="Password" hint="Show / hide is a real, focusable button.">
              <PasswordInput placeholder="Master password" defaultValue="correct horse" />
            </Field>
            <Field label="Notes" hint="Textarea: same look as Input, grows on request.">
              <Textarea placeholder="Personal servers, work infrastructure..." rows={2} />
            </Field>
          </div>
        </Section>

        <Section title="Tabs">
          <Tabs
            label="Settings sections"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'general', label: 'General', content: <p className="text-body text-fg-muted">General settings panel.</p> },
              { id: 'terminal', label: 'Terminal', icon: SquareTerminal, content: <p className="text-body text-fg-muted">Terminal settings panel.</p> },
              { id: 'sync', label: 'Vault Sync', content: <p className="text-body text-fg-muted">Sync settings panel.</p> },
              { id: 'beta', label: 'Beta', disabled: true, content: null },
            ]}
          />
        </Section>

        <Section title="Menu, Dialog and Card">
          <Row>
            <Menu
              label="Host actions"
              trigger={(props) => (
                <Button iconRight={ChevronDown} {...props}>
                  Actions
                </Button>
              )}
              items={[
                { id: 'connect', label: 'Connect', icon: SquareTerminal, shortcut: 'Enter', onSelect: () => setLastAction('connect') },
                { id: 'sftp', label: 'Open SFTP', icon: FolderOpen, onSelect: () => setLastAction('sftp') },
                { id: 'duplicate', label: 'Duplicate', icon: Copy, onSelect: () => setLastAction('duplicate') },
                { id: 'edit', label: 'Edit', icon: Pencil, disabled: true, onSelect: () => setLastAction('edit') },
                { id: 'sep', separator: true },
                { id: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => setLastAction('delete') },
              ]}
            />
            <Menu
              align="end"
              label="More"
              trigger={(props) => <IconButton icon={MoreHorizontal} label="More actions" {...props} />}
              items={[{ id: 'about', label: 'About', onSelect: () => setLastAction('about') }]}
            />
            <Button variant="danger" icon={Trash2} onClick={() => setDialogOpen(true)}>
              Delete host…
            </Button>
            <span role="status" className="text-body-sm text-fg-muted">
              Last action: {lastAction}
            </span>
          </Row>
          <Dialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            title="Delete production-web-01?"
            description="The host and its saved credentials are removed from this vault."
            size="sm"
            footer={
              <>
                <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    setDialogOpen(false);
                    setLastAction('deleted');
                  }}
                >
                  Delete
                </Button>
              </>
            }
          />
          <div className="grid max-w-3xl grid-cols-2 gap-4">
            <Card title="production-web-01" description="deploy@10.0.0.12:22" actions={<IconButton icon={MoreHorizontal} label="Host options" size="sm" />}>
              <p className="text-body-sm text-fg-muted">Last connected 2 hours ago.</p>
            </Card>
            <Card padding="none">
              <EmptyState
                icon={Server}
                title="No hosts yet"
                description="Add a server to connect to it over SSH or SFTP."
                action={
                  <Button variant="primary" icon={Plus}>
                    New Host
                  </Button>
                }
              />
            </Card>
          </div>
        </Section>
      </div>
    </main>
  );
}
