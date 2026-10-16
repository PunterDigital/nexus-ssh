import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestServer, type TestServer } from '../fixtures/ssh-server';

// SFTP browser (#2367 part 2): browse, create, rename, chmod and delete on a throwaway local
// SSH/SFTP server (never a real host), with an isolated profile and the local pane pointed at a
// temp dir (never the user's home folder). Ends with layout checks at the minimum window and 4K.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-sftpb-'));
const localDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-sftpb-local-'));
const remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-sftpb-remote-'));
const PASSWORD = 'e2e-Browse-Files-77!';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

let server: TestServer;
let app: ElectronApplication | undefined;

const remote = (...p: string[]) => path.join(remoteDir, ...p);

test.beforeAll(async () => {
  mkdirSync(remote('docs'));
  writeFileSync(remote('docs', 'inside.txt'), 'inside');
  writeFileSync(remote('notes.txt'), 'notes');
  writeFileSync(remote('old-name.txt'), 'rename me');
  writeFileSync(remote('doomed.txt'), 'delete me');
  writeFileSync(path.join(localDir, 'local.txt'), 'upload me');
  server = await startTestServer({ root: remoteDir });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  await server?.close();
  for (const dir of [userDataDir, localDir, remoteDir])
    rmSync(dir, { recursive: true, force: true });
});

/** Resize the real window (the OS enforces minWidth / minHeight) and return its outer size. */
async function setWindowSize(
  a: ElectronApplication,
  width: number,
  height: number
): Promise<number[]> {
  return a.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(w, h);
      return win.getSize();
    },
    [width, height]
  );
}

/**
 * Both panes are on screen, the page doesn't scroll, and no control in the SFTP view (toolbars,
 * path bars, divider, transfer panel) is off-screen or cut off by an overflow-clipping box.
 * Breadcrumb segments truncate by design and rows live in scrolling lists, so those are skipped.
 */
async function expectSftpFits(page: Page, label: string): Promise<void> {
  await page.waitForTimeout(400); // let the resize settle
  const report = await page.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const doc = document.documentElement;
    if (doc.scrollWidth > vw + 1)
      out.push(`page scrolls sideways (${doc.scrollWidth} > ${vw})`);
    if (doc.scrollHeight > vh + 1)
      out.push(`page scrolls down (${doc.scrollHeight} > ${vh})`);
    const main = document.querySelector('main')!;
    if (main.scrollWidth > main.clientWidth + 1)
      out.push(`main clips content sideways (${main.scrollWidth} > ${main.clientWidth})`);

    const panes = [
      ...document.querySelectorAll<HTMLElement>(
        'section[aria-label="Local files"], section[aria-label="Remote files"]'
      ),
    ];
    if (panes.length !== 2) out.push(`expected 2 panes, found ${panes.length}`);
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.textContent ?? '').trim().slice(0, 40)}"`;
    const box = (r: DOMRect) =>
      `${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)}`;

    let toolbarControls = 0;
    for (const pane of panes) {
      const pb = pane.getBoundingClientRect();
      for (const el of pane.querySelectorAll<HTMLElement>('[role="toolbar"] button')) {
        toolbarControls++;
        const r = el.getBoundingClientRect();
        if (
          r.left < pb.left - 1 ||
          r.right > pb.right + 1 ||
          r.top < pb.top - 1 ||
          r.bottom > pb.bottom + 1
        )
          out.push(
            `toolbar control outside its pane: ${describe(el)} at ${box(r)}, pane ${box(pb)}`
          );
      }
    }
    if (toolbarControls === 0) out.push('no pane toolbar controls found');

    for (const el of main.querySelectorAll<HTMLElement>(
      'button, input, select, [role="separator"]'
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || el.closest('nav')) continue;
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1)
        out.push(`off-screen: ${describe(el)} at ${box(r)} (viewport ${vw}x${vh})`);
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') break; // scrolls on purpose
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const b = p.getBoundingClientRect();
        if (
          r.left < b.left - 1 ||
          r.right > b.right + 1 ||
          r.top < b.top - 1 ||
          r.bottom > b.bottom + 1
        ) {
          out.push(
            `cut off: ${describe(el)} at ${box(r)} by ${p.tagName.toLowerCase()} at ${box(b)}`
          );
          break;
        }
      }
    }
    return { out, vw, vh };
  });
  expect(report.out, `${label} (${report.vw}x${report.vh})`).toEqual([]);
}

test('SFTP browser: browse, create, rename, chmod and delete; fits from the minimum window to 4K', async () => {
  app = await electron.launch({
    ...(executablePath
      ? { executablePath, args: [] }
      : { args: [path.resolve(__dirname, '../..')] }),
    env: {
      ...process.env,
      NEXUS_USE_BUILT_RENDERER: '1',
      NEXUS_USER_DATA_DIR: userDataDir,
      NEXUS_DISABLE_IDLE_LOCK: '1',
    },
  });
  const page = await app.firstWindow();

  // Fresh vault
  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E SFTP Browser Vault');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });

  // Host pointing at the local test server, opened as SFTP
  await page.getByRole('button', { name: 'SFTP', exact: true }).click();
  await page.getByRole('button', { name: 'New Host' }).click();
  await page.getByPlaceholder('My Server').fill('E2E Browser Server');
  await page.getByPlaceholder('192.168.1.1 or example.com').fill(server.host);
  await page.getByPlaceholder('22').fill(String(server.port));
  await page.getByPlaceholder('root').fill(server.username);
  await page.getByPlaceholder('Enter password').fill(server.password);
  await page.getByRole('button', { name: 'Create Host' }).click();
  await page
    .getByRole('button', { name: /E2E Browser Server/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Accept Once' })
    .click({ timeout: 15_000 })
    .catch(() => {});

  const localList = page.getByRole('listbox', { name: 'Local files' });
  const remoteList = page.getByRole('listbox', { name: 'Remote files' });
  const remoteRow = (name: string) =>
    remoteList.getByRole('option', { name, exact: true });
  await expect(remoteRow('docs')).toBeVisible({ timeout: 30_000 });
  await expect(remoteRow('notes.txt')).toBeVisible();

  // Local pane → the temp dir, through the path editor
  await page.getByRole('button', { name: 'Edit local path' }).click();
  const localPathInput = page.getByRole('textbox', { name: 'Local path' });
  await localPathInput.fill(localDir);
  await localPathInput.press('Enter');
  await expect(
    localList.getByRole('option', { name: 'local.txt', exact: true })
  ).toBeVisible();

  // ── Browse: into a folder from the list (double-click), back with the breadcrumb ──
  await remoteRow('docs').dblclick();
  await expect(remoteRow('inside.txt')).toBeVisible();
  await expect(remoteRow('notes.txt')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Remote path' })
    .getByRole('button', { name: '/', exact: true })
    .click();
  await expect(remoteRow('notes.txt')).toBeVisible();

  // …and with the keyboard: Enter opens the focused folder, Backspace goes back to it
  await remoteRow('docs').click();
  await expect(remoteRow('docs')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(remoteRow('inside.txt')).toBeFocused();
  await page.keyboard.press('Backspace');
  await expect(remoteRow('docs')).toBeFocused();
  // Arrow keys move the selection; Shift+F10 opens the row's menu, Escape returns to the row
  await page.keyboard.press('ArrowDown'); // docs → doomed.txt (folders first, then by name)
  await expect(remoteRow('doomed.txt')).toBeFocused();
  await expect(remoteRow('doomed.txt')).toHaveAttribute('aria-selected', 'true');
  await expect(remoteRow('docs')).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu', { name: 'Actions for doomed.txt' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Download' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(remoteRow('doomed.txt')).toBeFocused();

  // ── Create a folder ──
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const folderName = page.getByRole('textbox', { name: 'New folder name' });
  await folderName.fill('created-dir');
  await folderName.press('Enter');
  await expect(remoteRow('created-dir')).toBeVisible();
  expect(statSync(remote('created-dir')).isDirectory()).toBe(true);

  // ── Rename (row menu → inline field) ──
  await remoteRow('old-name.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const renameInput = page.getByRole('textbox', { name: 'New name for old-name.txt' });
  await expect(renameInput).toBeFocused();
  await renameInput.fill('new-name.txt');
  await renameInput.press('Enter');
  await expect(remoteRow('new-name.txt')).toBeVisible();
  await expect(remoteRow('old-name.txt')).toHaveCount(0);
  expect(existsSync(remote('new-name.txt'))).toBe(true);
  expect(existsSync(remote('old-name.txt'))).toBe(false);

  // ── Permissions dialog ──
  await remoteRow('notes.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Permissions…' }).click();
  const chmod = page.getByRole('dialog', { name: 'Permissions for notes.txt' });
  await expect(chmod).toBeVisible();
  const octal = chmod.getByRole('textbox', { name: 'Octal' });
  // The dialog starts from the mode the server reported (the fixture serves the real file's mode)
  const diskMode = (statSync(remote('notes.txt')).mode & 0o777)
    .toString(8)
    .padStart(3, '0');
  await expect(octal).toHaveValue(diskMode);
  // Typing octal digits updates the checkboxes, and the checkboxes update the digits
  await octal.fill('640');
  const box = (cls: string, perm: string) =>
    chmod.getByRole('group', { name: cls }).getByRole('checkbox', { name: perm });
  await expect(box('Owner', 'Read')).toBeChecked();
  await expect(box('Owner', 'Write')).toBeChecked();
  await expect(box('Owner', 'Execute')).not.toBeChecked();
  await expect(box('Group', 'Read')).toBeChecked();
  await expect(box('Group', 'Write')).not.toBeChecked();
  await expect(box('Others', 'Read')).not.toBeChecked();
  await box('Owner', 'Execute').check();
  await expect(octal).toHaveValue('740');
  // A half-typed value is rejected instead of applying the old mode
  await octal.fill('74');
  await chmod.getByRole('button', { name: 'Set Permissions' }).click();
  await expect(chmod.getByText('Enter three digits from 0 to 7')).toBeVisible();
  await octal.fill('640');
  await chmod.getByRole('button', { name: 'Set Permissions' }).click();
  await expect(chmod).toHaveCount(0);
  // tests/fixtures/ssh-server.ts acknowledges SETSTAT without applying it, so the mode on disk
  // can't be checked here; the app's confirmation shows the mode it sent.
  await expect(
    page.getByRole('status').filter({ hasText: 'Permissions of notes.txt set to 640' })
  ).toBeVisible();

  // ── Delete asks first: Delete key → Cancel keeps the file; menu → Delete File removes it ──
  await remoteRow('doomed.txt').click();
  await page.keyboard.press('Delete');
  const confirm = page.getByRole('dialog', { name: 'Delete doomed.txt?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(remoteRow('doomed.txt')).toBeFocused();
  expect(existsSync(remote('doomed.txt'))).toBe(true);

  await remoteRow('doomed.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  await confirm.getByRole('button', { name: 'Delete File' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(remoteRow('doomed.txt')).toHaveCount(0);
  expect(existsSync(remote('doomed.txt'))).toBe(false);

  // A folder is deleted with everything in it (the preload used to drop isDirectory, so main
  // tried to unlink a directory and it always failed)
  writeFileSync(remote('created-dir', 'nested.txt'), 'nested');
  await remoteRow('created-dir').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  const confirmDir = page.getByRole('dialog', { name: 'Delete created-dir?' });
  await expect(confirmDir.getByText('everything in it')).toBeVisible();
  await confirmDir.getByRole('button', { name: 'Delete Folder' }).click();
  await expect(confirmDir).toHaveCount(0);
  await expect(remoteRow('created-dir')).toHaveCount(0);
  expect(existsSync(remote('created-dir'))).toBe(false);

  // An upload, so the transfer panel is part of the layout checks
  await localList
    .getByRole('option', { name: 'local.txt', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Upload' }).click();
  await expect(page.getByRole('button', { name: 'Clear completed' })).toBeVisible({
    timeout: 30_000,
  });
  expect(existsSync(remote('local.txt'))).toBe(true);
  await page
    .getByRole('toolbar', { name: 'Remote folder actions' })
    .getByRole('button', { name: 'Refresh' })
    .click();
  await expect(remoteRow('local.txt')).toBeVisible();

  // ── Layout: minimum window (real resize: the OS enforces the minimum), widest sidebar too ──
  const [minW, minH] = await setWindowSize(app, 400, 300);
  expect(minW).toBeGreaterThanOrEqual(900);
  expect(minH).toBeGreaterThanOrEqual(600);
  await expectSftpFits(page, 'minimum window');
  const sidebarHandle = page.getByRole('separator', { name: 'Resize sidebar' });
  await sidebarHandle.focus();
  await page.keyboard.press('End');
  await expectSftpFits(page, 'minimum window, widest sidebar');
  // The divider can't squeeze a pane below its minimum width
  await page.getByRole('separator', { name: 'Resize file panes' }).focus();
  await page.keyboard.press('Home');
  await expectSftpFits(page, 'minimum window, divider far left');
  await page.keyboard.press('End');
  await expectSftpFits(page, 'minimum window, divider far right');
  await page.keyboard.press('Enter'); // back to 50/50
  await sidebarHandle.focus();
  await page.keyboard.press('Home');

  // ── 4K (CSS pixels): emulated, last, because the emulation can't be turned off again ──
  await page.setViewportSize({ width: 3840, height: 2160 });
  await expectSftpFits(page, '4K');
  // Wide panes show every column
  await expect(page.getByRole('button', { name: /^Sort by Permissions/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Sort by Modified/ }).first()
  ).toBeVisible();
});
