import { describe, expect, it } from 'vitest';
import { DOMAIN_READY, ping } from './index';

describe('domain scaffold smoke', () => {
  it('exposes the wiring marker', () => {
    expect(DOMAIN_READY).toBe(true);
  });

  it('ping() returns the domain tag', () => {
    expect(ping()).toBe('domain');
  });
});
