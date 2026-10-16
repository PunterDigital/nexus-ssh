// ============================================================
// Snippet variables (spec §11): {{hostname}}, {{username}} and {{port}} come from the session
// the snippet runs in; {{custom:Label}} asks for a value. Pure functions, unit-tested in
// tests/unit/snippet-variables.test.ts.
// ============================================================

/** Built-in variables filled in from the session's host. */
export const BUILTIN_VARIABLES = ['hostname', 'username', 'port'] as const;
type BuiltinName = (typeof BUILTIN_VARIABLES)[number];

export interface SnippetVariable {
  /** The placeholder as written, e.g. "{{custom:Branch}}". */
  raw: string;
  /** builtin = filled from the session (an unknown name like {{foo}} is asked for); custom = asked for. */
  type: 'builtin' | 'custom';
  /** What the user sees: "Branch", or the built-in's name ("hostname"). */
  label: string;
  /** True for hostname / username / port. */
  known: boolean;
}

/** Host details of the session a snippet runs in. */
export interface SnippetContext {
  hostname?: string;
  username?: string;
  port?: number;
}

const VARIABLE = /\{\{(\w+(?::[\w\s]+)?)\}\}/g;

/** The distinct placeholders in a command, in order of first appearance. */
export function findVariables(command: string): SnippetVariable[] {
  const seen = new Set<string>();
  const out: SnippetVariable[] = [];
  for (const match of command.matchAll(VARIABLE)) {
    const raw = match[0];
    if (seen.has(raw)) continue;
    seen.add(raw);
    const inner = match[1];
    if (inner.startsWith('custom:')) {
      out.push({ raw, type: 'custom', label: inner.slice('custom:'.length).trim(), known: false });
    } else {
      out.push({ raw, type: 'builtin', label: inner, known: (BUILTIN_VARIABLES as readonly string[]).includes(inner) });
    }
  }
  return out;
}

/** The value a variable starts with: the session's host details for built-ins, empty otherwise. */
export function defaultValue(variable: SnippetVariable, context?: SnippetContext): string {
  if (variable.type !== 'builtin' || !variable.known) return '';
  switch (variable.label as BuiltinName) {
    case 'hostname':
      return context?.hostname ?? '';
    case 'username':
      return context?.username ?? '';
    case 'port':
      return String(context?.port ?? 22);
  }
}

/** Whether running the command needs the user to type something (a custom or unfilled variable). */
export function needsInput(command: string, context?: SnippetContext): boolean {
  return findVariables(command).some((v) => v.type === 'custom' || defaultValue(v, context) === '');
}

/**
 * Replaces each placeholder with its value (by `raw`), in one pass, so a value that itself
 * contains "{{…}}" is typed as is. Placeholders without a value are left unchanged.
 */
export function resolveCommand(command: string, values: Record<string, string>): string {
  return command.replace(VARIABLE, (raw) => values[raw] ?? raw);
}

/** The command split into plain text and placeholders, for highlighting. */
export function commandParts(command: string): { text: string; variable: boolean }[] {
  const parts: { text: string; variable: boolean }[] = [];
  let last = 0;
  for (const match of command.matchAll(VARIABLE)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: command.slice(last, index), variable: false });
    parts.push({ text: match[0], variable: true });
    last = index + match[0].length;
  }
  if (last < command.length) parts.push({ text: command.slice(last), variable: false });
  return parts;
}

/** The lines typed into the terminal, one Enter each. Windows line endings count as one break. */
export function commandLines(command: string): string[] {
  return command.split(/\r?\n/);
}
