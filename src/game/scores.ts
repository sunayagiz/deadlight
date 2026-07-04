/**
 * Local-first leaderboard: the best score per seed, persisted in localStorage.
 * Render-layer only — lives OUTSIDE GameState/sim so the deterministic sim never
 * touches storage or the clock. A networked/global leaderboard is intentionally
 * out of scope (a serverless backend can slot in later behind this same API).
 */

const KEY = 'deadlight.scores.v1';

type ScoreMap = Record<string, number>;

function load(): ScoreMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ScoreMap) : {};
  } catch {
    return {}; // storage disabled / private mode / bad JSON → behave as empty
  }
}

function save(map: ScoreMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* ignore: nothing we can do if storage is unavailable */
  }
}

/** Best score recorded for `seed` so far (0 if none). */
export function bestScore(seed: string): number {
  return load()[seed] ?? 0;
}

/** Record `score` for `seed`; keep the max. Returns the best (possibly the new one). */
export function recordScore(seed: string, score: number): number {
  const map = load();
  const best = Math.max(map[seed] ?? 0, score);
  map[seed] = best;
  save(map);
  return best;
}

/** Today's date as YYYYMMDD (local time). Kept in the render layer — never in sim. */
export function todayYYYYMMDD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
