import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestServer, type TestServer } from '../fixtures/ssh-server';

// Snippets on the design system (#2367 part 2): empty state, create (with validation), edit,
// search, copy, delete through a confirm dialog, persistence across lock / unlock, and running
// snippets (custom and built-in variables) in a terminal on the throwaway local SSH server
// (never a real host). Runs at the minimum window size (900 x 600), where the list and every
// dialog must fit, and ends at 4K.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-snippets-'));
const remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-e2e-snippets-remote-'));
const PASSWORD = 'e2e-Snippets-Vault-58!';
const GREET = 'E2E Greet';
const GREET_COMMAND = 'echo {{custom:Greeting}}';
const HOST_ECHO = 'E2E Host Echo';
const HOST_ECHO_COMMAND = 'echo host-{{hostname}}\necho second-line';
const SERVER_LABEL = 'E2E Snippet Server';
const executablePath = process.env.NEXUS_E2E_EXECUTABLE;

// One app and vault for the whole file; each test builds on the previous one.
test.describe.configure({ mode: 'serial' });

let server: TestServer;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  server = await startTestServer({ root: remoteDir });
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
  page = await app.firstWindow();
  await setWindowSize(900, 600);
  // "Copy command" calls navigator.clipboard.writeText. The system clipboard is shared with the
  // other specs running in parallel, so record the writes instead.
  await recordClipboard();

  await page.getByRole('button', { name: 'Create Your First Vault' }).click();
  await page.getByPlaceholder('My Vault').fill('E2E Snippets Vault');
  await page.getByPlaceholder('Choose a strong password').fill(PASSWORD);
  await page.getByPlaceholder('Repeat your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click();
  await expect(page.getByText('No connections yet')).toBeVisible({ timeout: 30_000 });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  await server?.close();
  for (const dir of [userDataDir, remoteDir]) rmSync(dir, { recursive: true, force: true });
});

const main = () => page.locator('main');
const nav = (name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true });
const snippetList = () => main().getByRole('list', { name: 'Snippets' });
const snippetItem = (name: string) => snippetList().getByRole('listitem').filter({ hasText: name });
const readClipboard = () => page.evaluate(() => (window as unknown as { __copied: string }).__copied);

async function recordClipboard(): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __copied: string };
    w.__copied = '';
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async (text: string) => {
        w.__copied = text;
      },
    });
  });
}

/** Resize the real window (the OS enforces minWidth / minHeight). */
async function setWindowSize(width: number, height: number): Promise<void> {
  await app!.evaluate(
    ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h),
    [width, height],
  );
}

/** The dialog fits in the window and its primary action is on screen. */
async function expectDialogFits(dialog: Locator, primary: string): Promise<void> {
  await expect(dialog.getByRole('button', { name: primary, exact: true })).toBeInViewport();
  const fits = await dialog.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
  });
  expect(fits).toBe(true);
}

/** The page doesn't scroll, and no control in the main area is cut off sideways. */
async function expectNothingClipped(label: string): Promise<void> {
  await page.waitForTimeout(300);
  const report = await page.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const doc = document.documentElement;
    if (doc.scrollWidth > vw + 1) out.push(`page scrolls sideways (${doc.scrollWidth} > ${vw})`);
    if (doc.scrollHeight > vh + 1) out.push(`page scrolls down (${doc.scrollHeight} > ${vh})`);
    const main = document.querySelector('main')!;
    if (main.scrollWidth > main.clientWidth + 1)
      out.push(`main clips content sideways (${main.scrollWidth} > ${main.clientWidth})`);
    const box = main.getBoundingClientRect();
    for (const el of main.querySelectorAll<HTMLElement>('button, input, select, textarea, h2')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1)
        out.push(
          `cut off: ${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" at ${Math.round(r.left)}–${Math.round(r.right)}, main ${Math.round(box.left)}–${Math.round(box.right)}`,
        );
    }
    return { out, vw, vh };
  });
  expect(report.out, `${label} (${report.vw}x${report.vh})`).toEqual([]);
}

async function openActions(name: string): Promise<void> {
  await snippetItem(name).getByRole('button', { name: `More actions for ${name}` }).click();
}

test('Snippets opens from the sidebar and shows the empty state', async () => {
  await nav('Snippets').click();
  await expect(nav('Snippets')).toHaveAttribute('aria-current', 'page');
  await expect(main().getByRole('heading', { name: 'Snippets', exact: true })).toBeVisible();
  await expect(main().getByText('No snippets yet')).toBeVisible();
  await expect(main().getByText('0 snippets')).toBeVisible();
  // Nothing to search yet.
  await expect(main().getByRole('textbox', { name: 'Search snippets' })).toHaveCount(0);
  await expectNothingClipped('empty state');
});

test('creating a snippet: empty name and command are rejected, then it is saved', async () => {
  await main().getByRole('button', { name: 'New Snippet' }).click();
  const dialog = page.getByRole('dialog', { name: 'New Snippet' });
  await expect(dialog).toBeVisible();
  await expectDialogFits(dialog, 'Create Snippet');

  const name = dialog.getByPlaceholder('e.g. Deploy to Production');
  const command = dialog.getByRole('textbox', { name: 'Command' });
  await expect(name).toBeFocused();

  // Submitting empty shows both errors under the fields, focuses the first and saves nothing.
  await dialog.getByRole('button', { name: 'Create Snippet', exact: true }).click();
  await expect(dialog.getByText('Name is required')).toBeVisible();
  await expect(dialog.getByText('Command is required')).toBeVisible();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(command).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toBeFocused();

  // Typing clears each error.
  await name.fill(GREET);
  await expect(dialog.getByText('Name is required')).toHaveCount(0);
  await dialog.getByPlaceholder('What does this snippet do?').fill('Says hello');
  await command.fill(GREET_COMMAND);
  await expect(dialog.getByText('Command is required')).toHaveCount(0);

  // The variable is listed with how it gets its value.
  const vars = dialog.getByRole('list', { name: 'Variables in the command' });
  await expect(vars.getByRole('listitem')).toHaveCount(1);
  await expect(vars).toContainText('{{custom:Greeting}}');
  await expect(vars).toContainText('Asks for “Greeting” when run');
  await expectDialogFits(dialog, 'Create Snippet');

  await dialog.getByRole('button', { name: 'Create Snippet', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: `Snippet "${GREET}" created` })).toBeVisible();
  await expect(snippetItem(GREET)).toContainText('Says hello');
  await expect(snippetItem(GREET)).toContainText(GREET_COMMAND);
  await expect(main().getByText('1 snippet', { exact: true })).toBeVisible();

  // A second, multi-line snippet with a built-in variable.
  await main().getByRole('button', { name: 'New Snippet' }).click();
  const second = page.getByRole('dialog', { name: 'New Snippet' });
  await second.getByPlaceholder('e.g. Deploy to Production').fill(HOST_ECHO);
  await second.getByRole('textbox', { name: 'Command' }).fill(HOST_ECHO_COMMAND);
  await expect(second.getByRole('list', { name: 'Variables in the command' })).toContainText(
    'Filled in with the session’s hostname',
  );
  // Enter in the name field submits the form.
  await second.getByPlaceholder('e.g. Deploy to Production').press('Enter');
  await expect(second).toHaveCount(0);
  await expect(snippetItem(HOST_ECHO)).toContainText('echo host-{{hostname}}');
  await expect(snippetItem(HOST_ECHO)).toContainText('+1 line');
  await expect(main().getByText('2 snippets')).toBeVisible();
});

test('editing a snippet keeps its values and saves the changes', async () => {
  await snippetItem(GREET).getByRole('button', { name: `Edit ${GREET}` }).click();
  const dialog = page.getByRole('dialog', { name: `Edit ${GREET}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder('e.g. Deploy to Production')).toHaveValue(GREET);
  await expect(dialog.getByRole('textbox', { name: 'Command' })).toHaveValue(GREET_COMMAND);

  // Clearing the name is rejected like on create.
  await dialog.getByPlaceholder('e.g. Deploy to Production').fill('');
  await dialog.getByRole('button', { name: 'Save Changes' }).click();
  await expect(dialog.getByText('Name is required')).toBeVisible();
  await dialog.getByPlaceholder('e.g. Deploy to Production').fill(GREET);

  await dialog.getByPlaceholder('What does this snippet do?').fill('Says hello again');
  const runOnConnect = dialog.getByRole('checkbox', { name: /Run on connect/ });
  await expect(runOnConnect).not.toBeChecked();
  await runOnConnect.check();
  await expectDialogFits(dialog, 'Save Changes');
  await dialog.getByRole('button', { name: 'Save Changes' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: `Snippet "${GREET}" updated` })).toBeVisible();
  await expect(snippetItem(GREET)).toContainText('Says hello again');
  await expect(snippetItem(GREET)).toContainText('Auto-run');

  // Cancel throws away an edit; the menu opens the same form.
  await openActions(GREET);
  await page.getByRole('menuitem', { name: 'Edit snippet…' }).click();
  const again = page.getByRole('dialog', { name: `Edit ${GREET}` });
  await again.getByPlaceholder('What does this snippet do?').fill('Not saved');
  await again.getByRole('button', { name: 'Cancel' }).click();
  await expect(again).toHaveCount(0);
  await expect(snippetItem(GREET)).toContainText('Says hello again');
});

test('search filters by name, description and command', async () => {
  const search = main().getByRole('textbox', { name: 'Search snippets' });
  await search.fill('host echo');
  await expect(snippetList().getByRole('listitem')).toHaveCount(1);
  await expect(snippetItem(HOST_ECHO)).toBeVisible();

  await search.fill('HELLO AGAIN'); // description, any case
  await expect(snippetList().getByRole('listitem')).toHaveCount(1);
  await expect(snippetItem(GREET)).toBeVisible();

  await search.fill('second-line'); // command
  await expect(snippetList().getByRole('listitem')).toHaveCount(1);
  await expect(snippetItem(HOST_ECHO)).toBeVisible();

  await search.fill('zzz-nothing');
  await expect(main().getByText('No snippets match “zzz-nothing”')).toBeVisible();
  await main().getByRole('button', { name: 'Clear search' }).click();
  await expect(search).toHaveValue('');
  await expect(snippetList().getByRole('listitem')).toHaveCount(2);

  // Escape in the field clears it too.
  await search.fill('greet');
  await expect(snippetList().getByRole('listitem')).toHaveCount(1);
  await search.press('Escape');
  await expect(snippetList().getByRole('listitem')).toHaveCount(2);
});

test('the menu copies the command and is keyboard-operable', async () => {
  const trigger = snippetItem(GREET).getByRole('button', { name: `More actions for ${GREET}` });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: `Actions for ${GREET}` });
  await expect(menu).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Run snippet…' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await openActions(GREET);
  await page.getByRole('menuitem', { name: 'Copy command' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'copied to clipboard' })).toBeVisible();
  expect(await readClipboard()).toBe(GREET_COMMAND);
});

test('without a connected terminal, the Run dialog says so and cannot run', async () => {
  await snippetItem(GREET).getByRole('button').first().click();
  const dialog = page.getByRole('dialog', { name: `Run "${GREET}"?` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Says hello again');
  await expect(dialog).toContainText('No connected terminal is active');
  await expect(dialog.getByRole('button', { name: 'Run in Session' })).toBeDisabled();
  await expectDialogFits(dialog, 'Run in Session');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('at the minimum window nothing in the list is clipped', async () => {
  await setWindowSize(900, 600);
  await expectNothingClipped('900x600 with snippets');
  // A long name and command truncate instead of pushing the row wider.
  await main().getByRole('button', { name: 'New Snippet' }).click();
  const dialog = page.getByRole('dialog', { name: 'New Snippet' });
  await dialog.getByPlaceholder('e.g. Deploy to Production').fill(`E2E Long ${'name '.repeat(30)}`.trim());
  await dialog.getByRole('textbox', { name: 'Command' }).fill(`echo ${'x'.repeat(400)} {{custom:A very long variable label}}`);
  await expectDialogFits(dialog, 'Create Snippet');
  await dialog.getByRole('button', { name: 'Create Snippet', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main().getByText('3 snippets')).toBeVisible();
  await expectNothingClipped('900x600 with a long snippet');
});

test('snippets persist across lock and unlock', async () => {
  await page.getByRole('button', { name: 'Lock vault' }).click();
  const master = page.getByPlaceholder('Master password');
  await master.fill(PASSWORD);
  await master.press('Enter');
  // Unlocking returns to the view that was open (Snippets).
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 30_000 });
  await recordClipboard();

  await nav('Snippets').click();
  await expect(main().getByText('3 snippets')).toBeVisible();
  await expect(snippetItem(GREET)).toContainText('Says hello again');
  await expect(snippetItem(GREET)).toContainText('Auto-run');
  await expect(snippetItem(HOST_ECHO)).toContainText('echo host-{{hostname}}');
});

test('running snippets types the resolved command into the active terminal', async () => {
  // A host on the local test server, then a terminal to it.
  await nav('Hosts').click();
  await main().getByRole('button', { name: 'New Host' }).click();
  await page.getByPlaceholder('My Server').fill(SERVER_LABEL);
  await page.getByPlaceholder('192.168.1.1 or example.com').fill(server.host);
  await page.getByPlaceholder('22').fill(String(server.port));
  await page.getByPlaceholder('root').fill(server.username);
  await page.getByPlaceholder('Enter password').fill(server.password);
  await page.getByRole('button', { name: 'Create Host' }).click();
  await page.getByRole('button', { name: new RegExp(SERVER_LABEL) }).first().click();
  await page
    .getByRole('button', { name: 'Accept Once' })
    .click({ timeout: 5_000 })
    .catch(() => {});

  // Custom variable: asked for, required, previewed, then typed into the terminal.
  await nav('Snippets').click();
  await snippetItem(GREET).getByRole('button').first().click();
  const dialog = page.getByRole('dialog', { name: `Run "${GREET}"?` });
  await expect(dialog).toContainText(`Runs in ${SERVER_LABEL}`, { timeout: 30_000 });
  await expect(dialog).toContainText(`${server.username}@${server.host}`);
  const greeting = dialog.getByRole('textbox', { name: 'Greeting' });
  await expect(greeting).toBeFocused();
  await dialog.getByRole('button', { name: 'Run in Session' }).click();
  await expect(dialog.getByText('Enter a value for Greeting')).toBeVisible();
  await expect(greeting).toHaveAttribute('aria-invalid', 'true');
  await greeting.fill('nexus-snippet-hello');
  await expect(dialog.locator('pre')).toHaveText('echo nexus-snippet-hello');
  await expectDialogFits(dialog, 'Run in Session');
  await greeting.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: `Ran "${GREET}" in ${SERVER_LABEL}` })).toBeVisible();
  await expect.poll(() => server.commands).toContain('echo nexus-snippet-hello');

  // Built-in variable: filled from the session's host; each line is entered on its own.
  await snippetItem(HOST_ECHO).getByRole('button').first().click();
  const second = page.getByRole('dialog', { name: `Run "${HOST_ECHO}"?` });
  await expect(second.getByRole('textbox', { name: 'hostname' })).toHaveValue(server.host);
  await expect(second.locator('pre')).toHaveText(`echo host-${server.host}\necho second-line`);
  await second.getByRole('button', { name: 'Run in Session' }).click();
  await expect(second).toHaveCount(0);
  await expect.poll(() => server.commands).toContain(`echo host-${server.host}`);
  await expect.poll(() => server.commands).toContain('echo second-line');
  expect(server.commands.join('\n')).not.toContain('{{');

  // The sidebar's quick runner opens the same dialog (it used to send {{custom:…}} unfilled).
  await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: 'Run Snippet' }).click();
  await page.getByRole('menuitem', { name: GREET }).click();
  const quick = page.getByRole('dialog', { name: `Run "${GREET}"?` });
  const quickGreeting = quick.getByRole('textbox', { name: 'Greeting' });
  await expect(quickGreeting).toBeFocused();
  await quickGreeting.fill('from-the-sidebar');
  await quickGreeting.press('Enter');
  await expect(quick).toHaveCount(0);
  await expect.poll(() => server.commands).toContain('echo from-the-sidebar');
});

test('deleting a snippet asks first; Cancel keeps it, Delete Snippet removes it', async () => {
  const openDelete = async () => {
    await openActions(HOST_ECHO);
    await page.getByRole('menuitem', { name: 'Delete snippet…' }).click();
    const dialog = page.getByRole('dialog', { name: `Delete ${HOST_ECHO}?` });
    await expect(dialog).toBeVisible();
    return dialog;
  };

  let dialog = await openDelete();
  await expectDialogFits(dialog, 'Delete Snippet');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(snippetItem(HOST_ECHO)).toBeVisible();

  dialog = await openDelete();
  await dialog.getByRole('button', { name: 'Delete Snippet' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: `Snippet "${HOST_ECHO}" deleted` })).toBeVisible();
  await expect(snippetItem(HOST_ECHO)).toHaveCount(0);
  await expect(main().getByText('2 snippets')).toBeVisible();
});

test('at 4K the list and dialogs still fit', async () => {
  // Emulated, since a real window can't outgrow a CI runner's screen. Last, because the
  // emulation can't be turned off again.
  await page.setViewportSize({ width: 3840, height: 2160 });
  await expectNothingClipped('4K');
  await snippetItem(GREET).getByRole('button', { name: `Edit ${GREET}` }).click();
  const dialog = page.getByRole('dialog', { name: `Edit ${GREET}` });
  await expectDialogFits(dialog, 'Save Changes');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});
