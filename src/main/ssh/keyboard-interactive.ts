/**
 * Answers to an SSH keyboard-interactive round (#5612). No Electron imports: unit-tested
 * (tests/unit/security-hardening.test.ts).
 *
 * Every prompt used to get the stored password, so a server (or anything in the middle of a
 * login) that asked for a one-time code, a security question or a visible "username" got the
 * password typed into it. Now the password only answers a round of exactly one hidden prompt
 * that asks for a password, which is how servers do password auth over keyboard-interactive.
 * Anything else gets empty answers, so that method fails and ssh2 moves on. Answering such
 * prompts needs a prompt dialog in the app; until then those logins fail as they did before
 * (a password typed into an OTP prompt never worked either).
 */

export interface KeyboardPrompt {
  prompt: string;
  echo?: boolean;
}

export function keyboardInteractiveAnswers(
  prompts: readonly KeyboardPrompt[],
  password: string | null | undefined,
): string[] {
  if (
    password &&
    prompts.length === 1 &&
    prompts[0].echo !== true &&
    /password/i.test(prompts[0].prompt)
  ) {
    return [password];
  }
  return prompts.map(() => '');
}
