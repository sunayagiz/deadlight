import { describe, expect, it } from 'vitest';
import {
  TIPS,
  TIP_DURATION,
  createTipQueue,
  enqueueTip,
  tickTipQueue,
} from '../../src/game/tips';

// The persistence half (hasSeenTip/markTipSeen/resetTips) is a thin localStorage
// wrapper mirroring scores/profile/settings; the interesting, testable logic is the
// pure tip QUEUE that guarantees one-tip-at-a-time, no overlap, and auto-dismiss.

describe('tip queue', () => {
  it('shows one tip at a time and promotes the next only after the first expires', () => {
    const q = createTipQueue();
    enqueueTip(q, 'a', 'first');
    enqueueTip(q, 'b', 'second');
    expect(q.current).toBeNull(); // nothing shows until the first tick promotes one

    tickTipQueue(q, 0);
    expect(q.current?.id).toBe('a');
    expect(q.pending.map((p) => p.id)).toEqual(['b']); // 'b' waits, never overlapping 'a'

    // still 'a' partway through its lifetime
    tickTipQueue(q, TIP_DURATION - 0.1);
    expect(q.current?.id).toBe('a');

    // 'a' expires → 'b' promoted on the same tick
    tickTipQueue(q, 0.2);
    expect(q.current?.id).toBe('b');
    expect(q.pending).toHaveLength(0);

    // 'b' expires → queue empties (nothing to render)
    tickTipQueue(q, TIP_DURATION);
    expect(q.current).toBeNull();
  });

  it('never queues the same tip twice (guards a per-frame trigger)', () => {
    const q = createTipQueue();
    expect(enqueueTip(q, 'a', 'x')).toBe(true);
    expect(enqueueTip(q, 'a', 'x')).toBe(false); // already pending
    tickTipQueue(q, 0); // 'a' now current
    expect(enqueueTip(q, 'a', 'x')).toBe(false); // already current
    expect(q.pending).toHaveLength(0);
  });

  it('has short, emoji-free copy for every tip id', () => {
    // Emoji plane only — the project deliberately uses mono glyphs (✕ ✦ ☠) as
    // symbols, so those are allowed; true colour-emoji pictographs are not.
    const EMOJI = /[\u{1F000}-\u{1FAFF}]|️/u;
    for (const [id, text] of Object.entries(TIPS)) {
      expect(text.length).toBeGreaterThan(0);
      expect(text.length).toBeLessThanOrEqual(90);
      expect(EMOJI.test(text), `${id} must be emoji-free`).toBe(false);
    }
  });
});
