import type { NexusTheme } from '../../shared/types';
import { readableOn } from './contrast';

// ============================================================
// Nexus SSH Client — Bundled Themes
// ============================================================

export const draculaTheme: NexusTheme = {
  id: 'dracula',
  name: 'Dracula',
  builtIn: true,
  ui: {
    name: 'Dracula',
    bgPrimary: '#282a36',
    bgSecondary: '#1e1f29',
    bgTertiary: '#44475a',
    textPrimary: '#fafaf5',
    textSecondary: '#ccabfa',
    textMuted: '#aeb6d0',
    accent: '#bd93f9',
    border: '#44475a',
    danger: '#ff5555',
    success: '#50fa7b',
    warning: '#f1fa8c',
  },
  terminal: {
    name: 'Dracula',
    foreground: '#f8f8f2',
    background: '#282a36',
    cursor: '#f8f8f2',
    cursorAccent: '#282a36',
    selection: 'rgba(68, 71, 90, 0.5)',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff',
  },
};

export const nordTheme: NexusTheme = {
  id: 'nord',
  name: 'Nord',
  builtIn: true,
  ui: {
    name: 'Nord',
    bgPrimary: '#2e3440',
    bgSecondary: '#272c36',
    bgTertiary: '#3b4252',
    textPrimary: '#f0f3f6',
    textSecondary: '#a2ceda',
    textMuted: '#a9aeb8',
    accent: '#88c0d0',
    border: '#3b4252',
    danger: '#bf616a',
    success: '#a3be8c',
    warning: '#ebcb8b',
  },
  terminal: {
    name: 'Nord',
    foreground: '#d8dee9',
    background: '#2e3440',
    cursor: '#d8dee9',
    cursorAccent: '#2e3440',
    selection: 'rgba(67, 76, 94, 0.5)',
    black: '#3b4252',
    red: '#bf616a',
    green: '#a3be8c',
    yellow: '#ebcb8b',
    blue: '#81a1c1',
    magenta: '#b48ead',
    cyan: '#88c0d0',
    white: '#e5e9f0',
    brightBlack: '#4c566a',
    brightRed: '#bf616a',
    brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b',
    brightBlue: '#81a1c1',
    brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb',
    brightWhite: '#eceff4',
  },
};

export const monokaiTheme: NexusTheme = {
  id: 'monokai',
  name: 'Monokai',
  builtIn: true,
  ui: {
    name: 'Monokai',
    bgPrimary: '#272822',
    bgSecondary: '#1e1f1c',
    bgTertiary: '#3e3d32',
    textPrimary: '#fafaf5',
    textSecondary: '#bae85c',
    textMuted: '#a9a79b',
    accent: '#a6e22e',
    border: '#3e3d32',
    danger: '#f92672',
    success: '#a6e22e',
    warning: '#e6db74',
  },
  terminal: {
    name: 'Monokai',
    foreground: '#f8f8f2',
    background: '#272822',
    cursor: '#f8f8f2',
    cursorAccent: '#272822',
    selection: 'rgba(73, 72, 62, 0.5)',
    black: '#272822',
    red: '#f92672',
    green: '#a6e22e',
    yellow: '#f4bf75',
    blue: '#66d9ef',
    magenta: '#ae81ff',
    cyan: '#a1efe4',
    white: '#f8f8f2',
    brightBlack: '#75715e',
    brightRed: '#f92672',
    brightGreen: '#a6e22e',
    brightYellow: '#f4bf75',
    brightBlue: '#66d9ef',
    brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4',
    brightWhite: '#f9f8f5',
  },
};

export const gruvboxTheme: NexusTheme = {
  id: 'gruvbox',
  name: 'Gruvbox',
  builtIn: true,
  ui: {
    name: 'Gruvbox',
    bgPrimary: '#282828',
    bgSecondary: '#1d2021',
    bgTertiary: '#3c3836',
    textPrimary: '#efe3c3',
    textSecondary: '#c8ca56',
    textMuted: '#a7a19c',
    accent: '#b8bb26',
    border: '#3c3836',
    danger: '#fb4934',
    success: '#b8bb26',
    warning: '#fabd2f',
  },
  terminal: {
    name: 'Gruvbox',
    foreground: '#ebdbb2',
    background: '#282828',
    cursor: '#ebdbb2',
    cursorAccent: '#282828',
    selection: 'rgba(60, 56, 54, 0.5)',
    black: '#282828',
    red: '#cc241d',
    green: '#98971a',
    yellow: '#d79921',
    blue: '#458588',
    magenta: '#b16286',
    cyan: '#689d6a',
    white: '#a89984',
    brightBlack: '#928374',
    brightRed: '#fb4934',
    brightGreen: '#b8bb26',
    brightYellow: '#fabd2f',
    brightBlue: '#83a598',
    brightMagenta: '#d3869b',
    brightCyan: '#8ec07c',
    brightWhite: '#ebdbb2',
  },
};

export const oneDarkTheme: NexusTheme = {
  id: 'one-dark',
  name: 'One Dark',
  builtIn: true,
  ui: {
    name: 'One Dark',
    bgPrimary: '#282c34',
    bgSecondary: '#21252b',
    bgTertiary: '#2c313a',
    textPrimary: '#bdc3cd',
    textSecondary: '#84c1f3',
    textMuted: '#9498a0',
    accent: '#61afef',
    border: '#3e4452',
    danger: '#e06c75',
    success: '#98c379',
    warning: '#e5c07b',
  },
  terminal: {
    name: 'One Dark',
    foreground: '#abb2bf',
    background: '#282c34',
    cursor: '#528bff',
    cursorAccent: '#282c34',
    selection: 'rgba(62, 68, 82, 0.5)',
    black: '#282c34',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#abb2bf',
    brightBlack: '#5c6370',
    brightRed: '#be5046',
    brightGreen: '#98c379',
    brightYellow: '#d19a66',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#ffffff',
  },
};

export const solarizedDarkTheme: NexusTheme = {
  id: 'solarized-dark',
  name: 'Solarized Dark',
  builtIn: true,
  ui: {
    name: 'Solarized Dark',
    bgPrimary: '#002b36',
    bgSecondary: '#001e26',
    bgTertiary: '#073642',
    textPrimary: '#9eacad',
    textSecondary: '#56a5dc',
    textMuted: '#8c9b9f',
    accent: '#268bd2',
    border: '#073642',
    danger: '#dc322f',
    success: '#859900',
    warning: '#b58900',
  },
  terminal: {
    name: 'Solarized Dark',
    foreground: '#839496',
    background: '#002b36',
    cursor: '#839496',
    cursorAccent: '#002b36',
    selection: 'rgba(7, 54, 66, 0.5)',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#002b36',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
};

export const tokyoNightTheme: NexusTheme = {
  id: 'tokyo-night',
  name: 'Tokyo Night',
  builtIn: true,
  ui: {
    name: 'Tokyo Night',
    bgPrimary: '#1a1b26',
    bgSecondary: '#16161e',
    bgTertiary: '#24283b',
    textPrimary: '#ced6f7',
    textSecondary: '#97b6f9',
    textMuted: '#888eac',
    accent: '#7aa2f7',
    border: '#292e42',
    danger: '#f7768e',
    success: '#9ece6a',
    warning: '#e0af68',
  },
  terminal: {
    name: 'Tokyo Night',
    foreground: '#c0caf5',
    background: '#1a1b26',
    cursor: '#c0caf5',
    cursorAccent: '#1a1b26',
    selection: 'rgba(40, 44, 63, 0.5)',
    black: '#15161e',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#a9b1d6',
    brightBlack: '#414868',
    brightRed: '#f7768e',
    brightGreen: '#9ece6a',
    brightYellow: '#e0af68',
    brightBlue: '#7aa2f7',
    brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff',
    brightWhite: '#c0caf5',
  },
};

export const BUNDLED_THEMES: NexusTheme[] = [
  draculaTheme,
  nordTheme,
  monokaiTheme,
  gruvboxTheme,
  oneDarkTheme,
  solarizedDarkTheme,
  tokyoNightTheme,
];

/**
 * Apply a NexusTheme to the document root by setting CSS custom properties.
 */
export function applyTheme(theme: NexusTheme): void {
  const root = document.documentElement;
  const { ui } = theme;

  root.style.setProperty('--color-bg-primary', ui.bgPrimary);
  root.style.setProperty('--color-bg-secondary', ui.bgSecondary);
  root.style.setProperty('--color-bg-tertiary', ui.bgTertiary);
  root.style.setProperty('--color-bg-hover', ui.bgTertiary);
  root.style.setProperty('--color-text-primary', ui.textPrimary);
  root.style.setProperty('--color-text-secondary', ui.textSecondary);
  root.style.setProperty('--color-text-muted', ui.textMuted);
  root.style.setProperty('--color-accent', ui.accent);
  root.style.setProperty('--color-accent-hover', ui.accent);
  root.style.setProperty('--color-accent-muted', `${ui.accent}26`);
  root.style.setProperty('--color-border', ui.border);
  root.style.setProperty('--color-border-focus', ui.accent);
  root.style.setProperty('--color-danger', ui.danger);
  root.style.setProperty('--color-success', ui.success);
  root.style.setProperty('--color-warning', ui.warning);
  // Derived, not themeable: text on accent / danger fills, whichever of white or near-black reads best.
  root.style.setProperty('--color-accent-fg', readableOn(ui.accent));
  root.style.setProperty('--color-danger-fg', readableOn(ui.danger));
}

/**
 * Find a bundled theme by ID, falling back to Dracula.
 */
export function getThemeById(id: string): NexusTheme {
  return BUNDLED_THEMES.find((t) => t.id === id) ?? draculaTheme;
}
