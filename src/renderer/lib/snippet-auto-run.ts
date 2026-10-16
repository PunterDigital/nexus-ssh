import type { Snippet } from '../../shared/types';
import {
  commandLines,
  defaultValue,
  findVariables,
  needsInput,
  resolveCommand,
  type SnippetContext,
} from '../components/snippets/variables';

// ============================================================
// "Run on connect" snippets (#2673): typed into a terminal once its shell is open. Pure,
// unit-tested in tests/unit/snippet-auto-run.test.ts; the terminal store does the typing.
// ============================================================

export interface AutoRunPlan {
  /** Lines to type, one Enter each, in snippet name order. */
  lines: string[];
  /** Names of the snippets that run. */
  ran: string[];
  /** Names of the snippets left out: they need a value nobody is there to type. */
  skipped: string[];
}

/**
 * Which "Run on connect" snippets run, and what gets typed. Built-in variables are filled from
 * the session; a snippet with a {{custom:…}} variable (or a built-in the session can't fill)
 * is skipped, since nothing can prompt for it unattended.
 */
export function planAutoRun(snippets: readonly Snippet[], context: SnippetContext): AutoRunPlan {
  const plan: AutoRunPlan = { lines: [], ran: [], skipped: [] };
  const autoRun = snippets
    .filter((s) => s.run_on_connect)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  for (const snippet of autoRun) {
    if (needsInput(snippet.command, context)) {
      plan.skipped.push(snippet.name);
      continue;
    }
    const values = Object.fromEntries(
      findVariables(snippet.command).map((v) => [v.raw, defaultValue(v, context)]),
    );
    plan.lines.push(...commandLines(resolveCommand(snippet.command, values)));
    plan.ran.push(snippet.name);
  }
  return plan;
}

/** The toast for skipped snippets, or null when none were skipped. */
export function skippedMessage(skipped: readonly string[], hostLabel: string): string | null {
  if (skipped.length === 0) return null;
  const names = skipped.map((n) => `"${n}"`).join(', ');
  const verb = skipped.length === 1 ? 'needs a value' : 'need values';
  return `Didn't auto-run ${names} on ${hostLabel}: ${verb} to type in. Run ${skipped.length === 1 ? 'it' : 'them'} from Snippets.`;
}
