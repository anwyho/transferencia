import { afterEach, describe, expect, it } from 'vitest';
import {
	advanceClock,
	clockNow,
	currentOffset,
	resetClock,
	setClock,
	testControlEnabled
} from './clock';

afterEach(() => {
	resetClock();
	delete process.env.LT_TEST_CONTROL;
});

const DAY = 86_400_000;

describe('web clock + test control-plane (C.1)', () => {
	it('defaults to the wall clock (offset 0)', () => {
		expect(currentOffset()).toBe(0);
		expect(Math.abs(clockNow() - Date.now())).toBeLessThan(1000);
	});

	it('advance moves now forward by the offset', () => {
		advanceClock(DAY);
		expect(currentOffset()).toBe(DAY);
		expect(clockNow()).toBeGreaterThanOrEqual(Date.now() + DAY - 1000);
	});

	it('set pins now near an absolute epoch', () => {
		setClock(5_000_000_000);
		expect(Math.abs(clockNow() - 5_000_000_000)).toBeLessThan(1000);
	});

	it('reset returns to the wall clock', () => {
		advanceClock(999_999);
		resetClock();
		expect(currentOffset()).toBe(0);
	});

	it('testControlEnabled reflects LT_TEST_CONTROL', () => {
		expect(testControlEnabled()).toBe(false);
		process.env.LT_TEST_CONTROL = '1';
		expect(testControlEnabled()).toBe(true);
		process.env.LT_TEST_CONTROL = '0';
		expect(testControlEnabled()).toBe(false);
	});
});
