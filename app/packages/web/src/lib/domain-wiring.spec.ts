import { describe, expect, it } from 'vitest';
import { DOMAIN_READY, ping } from '@lt/domain';

// Proves the domain package is consumable from web's own (node-env) unit tests,
// i.e. the workspace link + Vite TS transpilation resolve correctly.
describe('web ↔ domain wiring', () => {
	it('consumes the isomorphic domain package', () => {
		expect(DOMAIN_READY).toBe(true);
		expect(ping()).toBe('domain');
	});
});
