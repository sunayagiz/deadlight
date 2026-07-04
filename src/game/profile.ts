/**
 * Persistent meta-progression profile — currency + unlocked loadouts + the active
 * loadout choice — kept in localStorage under a versioned key. Render/session-layer
 * ONLY: this lives OUTSIDE GameState/sim (the deterministic sim never touches
 * storage or the clock) and is NEVER part of the netcoded Snapshot. The unlocked
 * loadout is applied at run start by the host when building the world, so it shapes
 * the starting player without ever needing to sync as dynamic state.
 *
 * Mirrors scores.ts: guarded load/save that degrades to a fresh profile if storage
 * is disabled (private mode / bad JSON), so the game never crashes on it.
 */

const KEY = 'deadlight.profile.v1';

export interface Profile {
  currency: number;
  unlocked: string[]; // loadout ids the player owns
  selected: string; // active loadout id
}

function fresh(): Profile {
  return { currency: 0, unlocked: ['default'], selected: 'default' };
}

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const p = JSON.parse(raw) as Partial<Profile>;
    // Normalise: 'default' is always unlocked; keep the shape sane on old/bad data.
    const unlocked = Array.isArray(p.unlocked) ? p.unlocked.slice() : [];
    if (!unlocked.includes('default')) unlocked.push('default');
    return {
      currency: Number.isFinite(p.currency) ? Math.max(0, Math.floor(p.currency as number)) : 0,
      unlocked,
      selected: typeof p.selected === 'string' && unlocked.includes(p.selected) ? p.selected : 'default',
    };
  } catch {
    return fresh(); // storage disabled / private mode / bad JSON → behave as empty
  }
}

function save(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore: nothing we can do if storage is unavailable */
  }
}

/** The full current profile (always well-formed; 'default' is always unlocked). */
export function getProfile(): Profile {
  return load();
}

/** Award `n` currency (clamped ≥0). Returns the new balance. */
export function addCurrency(n: number): number {
  const p = load();
  p.currency = Math.max(0, p.currency + Math.floor(n));
  save(p);
  return p.currency;
}

/** True if `id` has been unlocked (or is 'default', which is free). */
export function isUnlocked(id: string): boolean {
  return load().unlocked.includes(id);
}

/** Mark `id` unlocked (idempotent). Returns the updated profile. */
export function unlock(id: string): Profile {
  const p = load();
  if (!p.unlocked.includes(id)) p.unlocked.push(id);
  save(p);
  return p;
}

/** Try to spend `n` currency. Returns true (and persists) only if affordable. */
export function spend(n: number): boolean {
  const p = load();
  if (p.currency < n) return false;
  p.currency -= n;
  save(p);
  return true;
}

/** Set the active loadout (only if it is unlocked; falls back to no-op otherwise). */
export function selectLoadout(id: string): void {
  const p = load();
  if (!p.unlocked.includes(id)) return;
  p.selected = id;
  save(p);
}

/** The active loadout id (guaranteed unlocked; 'default' if unset/invalid). */
export function getSelectedLoadout(): string {
  return load().selected;
}

/**
 * Currency earned for finishing a run — a pure, sim-agnostic function so it is
 * unit-testable without localStorage. Reaching a new wave is the main driver;
 * kills add a small trickle. Awarded exactly once per run by the end screen.
 */
export function runReward(wave: number, totalKills: number): number {
  return Math.max(0, Math.floor(wave) * 5 + Math.floor(totalKills / 10));
}
