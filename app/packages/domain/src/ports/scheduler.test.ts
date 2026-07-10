import { describe, expect, it } from 'vitest';
import { DAY_MS, trivialScheduler } from './scheduler';

describe('trivial scheduler (C.1 placeholder)', () => {
  it('schedules due one day out and stamps the blob with the attempt time', () => {
    const at = 1_700_000_000_000;
    const { blob, due } = trivialScheduler.apply(null, 'good', at);
    expect(due).toBe(at + DAY_MS);
    expect(blob).toEqual({ last: at });
  });

  it('ignores the prev blob and rating (placeholder has no memory)', () => {
    const at = 42;
    const withPrev = trivialScheduler.apply({ last: 1 }, 'again', at);
    const noPrev = trivialScheduler.apply(null, 'easy', at);
    expect(withPrev).toEqual(noPrev);
    expect(withPrev.due).toBe(at + DAY_MS);
  });

  it('produces a JSON-serialisable blob (opaque, versioned, round-trips)', () => {
    const { blob } = trivialScheduler.apply(null, 'good', 5);
    expect(JSON.parse(JSON.stringify(blob))).toEqual(blob);
  });
});
