import { describe, expect, it } from 'vitest';
import { __test__ } from './api';

describe('api URL normalization regressions', () => {
  it('forces https for http base when app is https', () => {
    const out = __test__.normalizeApiBaseUrl('http://api.example.com', {
      pageOrigin: 'https://app.example.com',
      pageProtocol: 'https:',
    });
    expect(out).toBe('https://api.example.com');
  });

  it('strips trailing slashes', () => {
    const out = __test__.normalizeApiBaseUrl('https://api.example.com////', {
      pageOrigin: 'https://app.example.com',
      pageProtocol: 'https:',
    });
    expect(out).toBe('https://api.example.com');
  });

  it('strips accidental /api from VITE_API_URL', () => {
    const out = __test__.normalizeApiBaseUrl('https://api.example.com/api', {
      pageOrigin: 'https://app.example.com',
      pageProtocol: 'https:',
    });
    expect(out).toBe('https://api.example.com');
  });

  it('strips accidental /api/v1 from VITE_API_URL', () => {
    const out = __test__.normalizeApiBaseUrl('https://api.example.com/api/v1/', {
      pageOrigin: 'https://app.example.com',
      pageProtocol: 'https:',
    });
    expect(out).toBe('https://api.example.com');
  });

  it('falls back to same-origin when empty', () => {
    const out = __test__.normalizeApiBaseUrl('', {
      pageOrigin: 'https://app.example.com',
      pageProtocol: 'https:',
    });
    expect(out).toBe('https://app.example.com');
  });

  it('upgrades signed/direct URLs to https when app is https', () => {
    expect(__test__.ensureHttpsIfNeeded('http://cdn.example.com/img.png', 'https:')).toBe(
      'https://cdn.example.com/img.png'
    );
    expect(__test__.ensureHttpsIfNeeded('https://cdn.example.com/img.png', 'https:')).toBe(
      'https://cdn.example.com/img.png'
    );
  });

  it('does not upgrade when app is http', () => {
    expect(__test__.ensureHttpsIfNeeded('http://cdn.example.com/img.png', 'http:')).toBe(
      'http://cdn.example.com/img.png'
    );
  });
});

