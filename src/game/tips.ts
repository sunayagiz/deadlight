/**
 * B9 — First-run onboarding: a "seen tips" store + a pure tip-queue.
 *
 * Render/UI-layer ONLY, exactly like scores.ts / profile.ts / settings.ts: it lives
 * OUTSIDE GameState/sim (the deterministic sim never touches storage or the clock)
 * and is NEVER part of the netcoded Snapshot. GameScene reads sim state to DETECT
 * first-time situations, shows a short contextual tip, and persists a "seen" flag so
 * each tip fires AT MOST ONCE EVER — across runs and sessions. No sim/netcode change.
 *
 * Two independent pieces:
 *  1. Persistence (localStorage, versioned key): hasSeenTip / markTipSeen / resetTips
 *     + loadSeenTips (one bulk read so GameScene never hits storage per frame).
 *  2. A pure, unit-testable tip QUEUE (no Phaser): one tip shows at a time, the rest
 *     wait so two never overlap; each auto-dismisses after TIP_DURATION.
 *
 * Mirrors the sibling modules' guarded load/save that degrades to "nothing seen" if
 * storage is disabled (private mode / bad JSON), so the game never crashes on it.
 */

const KEY = 'deadlight.tips.v1';

/**
 * Every contextual tip's id → its SHORT, action-first, emoji-free copy (this project
 * uses glyphs, never emoji). Exported so GameScene and the unit tests share one source
 * of truth for the wording.
 */
export const TIPS = {
  paydoor: 'Hold [F] near a door to buy it open ($)',
  powerup: 'Run over power-ups — Max Ammo, Insta-Kill, Nuke, Double Points',
  mysterybox: '[F] the Mystery Box (950) for a random weapon',
  packapunch: '[F] Pack-a-Punch to upgrade your gun (tiers I–III); + a catalyst = evolve it',
  wallbuy: '[F] a wall gun to buy it / refill ammo',
  power: '[F] the power switch to enable Pack-a-Punch & the box',
  perkdraft: 'Pick 1 of 3 perks. Rarer = more levels. Reroll ($) or banish (✕)',
  downed: "You're down — crawl to safety; a teammate revives you (solo: self-revive charges)",
  boss: 'BOSS INCOMING — a heavy hitter. Keep moving and focus fire',
  doground: "HELLHOUNDS — fast dogs incoming. Kite them, don't get cornered",
  zedtime: "Press [X] for Zed-Time — enemies slow, you don't",
} as const;

export type TipId = keyof typeof TIPS;

// ── persistence (localStorage) ───────────────────────────────────────────────

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set(); // storage disabled / private mode / bad JSON → behave as "nothing seen"
  }
}

function save(seen: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...seen]));
  } catch {
    /* ignore: nothing we can do if storage is unavailable */
  }
}

/** The full set of already-shown tip ids — one bulk read (GameScene caches this in memory). */
export function loadSeenTips(): Set<string> {
  return load();
}

/** True if `id` has been shown before (so it must never show again). */
export function hasSeenTip(id: string): boolean {
  return load().has(id);
}

/** Mark `id` as shown (idempotent), persisting so it never repeats across runs. */
export function markTipSeen(id: string): void {
  const seen = load();
  if (seen.has(id)) return;
  seen.add(id);
  save(seen);
}

/** Forget every shown tip so the onboarding tips can be seen again (used by HOW TO PLAY). */
export function resetTips(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// ── pure tip queue (no Phaser; unit-testable) ────────────────────────────────

/** Seconds a single tip stays on screen before it auto-dismisses. */
export const TIP_DURATION = 5.5;

/** One queued tip: its id + the copy to render. */
export interface TipItem {
  id: string;
  text: string;
}

/** Queue state: at most one tip showing, the rest waiting so two never overlap. */
export interface TipQueueState {
  current: { id: string; text: string; life: number } | null;
  pending: TipItem[];
}

/** A fresh, empty queue. */
export function createTipQueue(): TipQueueState {
  return { current: null, pending: [] };
}

/**
 * Queue a tip to show. No-ops (returns false) if it is already the current tip or
 * already waiting, so a per-frame trigger can't stack duplicates. Callers still gate
 * on hasSeenTip so this only ever runs once per id — this guards the same-frame path.
 */
export function enqueueTip(q: TipQueueState, id: string, text: string): boolean {
  if (q.current?.id === id) return false;
  if (q.pending.some((p) => p.id === id)) return false;
  q.pending.push({ id, text });
  return true;
}

/**
 * Advance the queue by `dt` seconds: age the current tip and, once it expires (or if
 * none is showing), promote the next pending one. Pure — GameScene just renders
 * `q.current` after calling this.
 */
export function tickTipQueue(q: TipQueueState, dt: number): void {
  if (q.current) {
    q.current.life -= dt;
    if (q.current.life <= 0) q.current = null;
  }
  if (!q.current && q.pending.length > 0) {
    const next = q.pending.shift()!;
    q.current = { id: next.id, text: next.text, life: TIP_DURATION };
  }
}
