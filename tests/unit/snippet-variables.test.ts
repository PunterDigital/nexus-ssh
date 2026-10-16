import { describe, it, expect } from 'vitest';
import {
  commandLines,
  commandParts,
  defaultValue,
  findVariables,
  needsInput,
  resolveCommand,
} from '../../src/renderer/components/snippets/variables';

// Snippet variables (#2367 part 2): {{hostname}} / {{username}} / {{port}} come from the session,
// {{custom:Label}} asks for a value.
const context = { hostname: 'web-01.example.com', username: 'deploy', port: 2222 };

describe('findVariables', () => {
  it('finds each placeholder once, in order, and tells built-ins from custom ones', () => {
    const vars = findVariables('ssh {{username}}@{{hostname}} -p {{port}} {{custom:Branch name}} {{hostname}} {{foo}}');
    expect(vars.map((v) => [v.raw, v.type, v.label, v.known])).toEqual([
      ['{{username}}', 'builtin', 'username', true],
      ['{{hostname}}', 'builtin', 'hostname', true],
      ['{{port}}', 'builtin', 'port', true],
      ['{{custom:Branch name}}', 'custom', 'Branch name', false],
      ['{{foo}}', 'builtin', 'foo', false],
    ]);
  });

  it('ignores text that only looks like a placeholder', () => {
    expect(findVariables('echo {{ hostname }} {hostname} {{custom:}}')).toEqual([]);
  });
});

describe('defaultValue / needsInput', () => {
  it('fills built-ins from the session and leaves custom and unknown ones empty', () => {
    const [user, host, port, branch, foo] = findVariables(
      '{{username}} {{hostname}} {{port}} {{custom:Branch}} {{foo}}',
    );
    expect(defaultValue(user, context)).toBe('deploy');
    expect(defaultValue(host, context)).toBe('web-01.example.com');
    expect(defaultValue(port, context)).toBe('2222');
    expect(defaultValue(branch, context)).toBe('');
    expect(defaultValue(foo, context)).toBe('');
    // No session: the port falls back to 22, the rest stay empty.
    expect(defaultValue(port)).toBe('22');
    expect(defaultValue(host)).toBe('');
  });

  it('needs input for custom variables and built-ins the session can’t fill', () => {
    expect(needsInput('uptime', context)).toBe(false);
    expect(needsInput('echo {{hostname}}:{{port}}', context)).toBe(false);
    expect(needsInput('echo {{username}}', { hostname: 'h' })).toBe(true);
    expect(needsInput('git checkout {{custom:Branch}}', context)).toBe(true);
  });
});

describe('resolveCommand', () => {
  it('replaces every occurrence and leaves placeholders without a value', () => {
    expect(
      resolveCommand('echo {{hostname}} {{hostname}} {{custom:X}}', { '{{hostname}}': 'web-01' }),
    ).toBe('echo web-01 web-01 {{custom:X}}');
  });

  it('types a value that contains a placeholder as is', () => {
    expect(
      resolveCommand('echo {{custom:A}} {{custom:B}}', { '{{custom:A}}': '{{custom:B}}', '{{custom:B}}': 'b' }),
    ).toBe('echo {{custom:B}} b');
  });
});

describe('commandParts / commandLines', () => {
  it('splits a command into text and placeholders', () => {
    expect(commandParts('cd {{custom:Dir}} && ls')).toEqual([
      { text: 'cd ', variable: false },
      { text: '{{custom:Dir}}', variable: true },
      { text: ' && ls', variable: false },
    ]);
    expect(commandParts('{{port}}')).toEqual([{ text: '{{port}}', variable: true }]);
  });

  it('splits lines on \\n and \\r\\n', () => {
    expect(commandLines('cd /tmp\r\nls\npwd')).toEqual(['cd /tmp', 'ls', 'pwd']);
    expect(commandLines('uptime')).toEqual(['uptime']);
  });
});
