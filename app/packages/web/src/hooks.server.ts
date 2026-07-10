import type { Handle } from '@sveltejs/kit';

/**
 * Multi-user seam from day one (design v2 §Multi-user): every request carries a
 * user. C.1 seeds the constant `u1` (also seeded in the DB); a real session cookie
 * lands later (not Lucia). Every repo query already filters by this id.
 */
export const handle: Handle = ({ event, resolve }) => {
	event.locals.user = { id: 'u1' };
	return resolve(event);
};
