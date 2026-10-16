import { describe, expect, it } from 'vitest';
import { isAllowedExternalUrl } from '../../src/main/shell/external-links';
import { DOWNLOADS_PAGE_URL, REPOSITORY_URL } from '../../src/shared/constants';

describe('isAllowedExternalUrl', () => {
  it('allows the repository and the downloads page, and pages below them', () => {
    expect(isAllowedExternalUrl(REPOSITORY_URL)).toBe(true);
    expect(isAllowedExternalUrl(DOWNLOADS_PAGE_URL)).toBe(true);
    expect(isAllowedExternalUrl(`${REPOSITORY_URL}/releases`)).toBe(true);
    expect(isAllowedExternalUrl(`${REPOSITORY_URL}/issues?q=is%3Aopen#top`)).toBe(true);
    expect(isAllowedExternalUrl('https://punterdigital.github.io/personal-apps')).toBe(true);
  });

  it('refuses other schemes, hosts and look-alike paths', () => {
    for (const url of [
      'http://github.com/PunterDigital/nexus-ssh',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'https://github.com/PunterDigital/nexus-ssh-evil',
      'https://github.com/PunterDigital',
      'https://github.com/',
      'https://evil.example/PunterDigital/nexus-ssh',
      'https://github.com.evil.example/PunterDigital/nexus-ssh',
      'https://punterdigital.github.io/other-site/',
      'https://user:pass@github.com/PunterDigital/nexus-ssh',
      'https://github.com:8443/PunterDigital/nexus-ssh',
      'not a url',
      '',
    ]) {
      expect(isAllowedExternalUrl(url), url).toBe(false);
    }
  });

  it('refuses non-strings', () => {
    expect(isAllowedExternalUrl(undefined)).toBe(false);
    expect(isAllowedExternalUrl(null)).toBe(false);
    expect(isAllowedExternalUrl({ toString: () => REPOSITORY_URL })).toBe(false);
  });
});
