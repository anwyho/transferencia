import { instrumentKey } from '../mastery/mastery';
import type { RedrillAttempt } from './redrill';

export interface SessionSummary {
  attempts: number;
  correct: number; // rating !== 'again'
  redrilled: number; // instruments served more than once this session
}

/** Pure end-of-session summary over the session's attempt rows (the done-screen numbers). */
export function sessionSummary(attempts: readonly RedrillAttempt[]): SessionSummary {
  const perInstrument = new Map<string, number>();
  let correct = 0;
  for (const a of attempts) {
    if (a.rating !== 'again') correct += 1;
    const key = instrumentKey(a.itemId, a.exerciseTypeKey, a.paramKey, a.direction);
    perInstrument.set(key, (perInstrument.get(key) ?? 0) + 1);
  }
  let redrilled = 0;
  for (const count of perInstrument.values()) if (count > 1) redrilled += 1;
  return { attempts: attempts.length, correct, redrilled };
}
