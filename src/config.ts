/** All feel/tuning constants. Tune here, nowhere else. */
export const SIM_DT = 1 / 60; // fixed simulation timestep (seconds)

export const PLAYER_SPEED = 220; // px/s
export const PLAYER_RADIUS = 14;
export const PLAYER_MAX_HP = 100;

export const DASH_SPEED = 640; // px/s
export const DASH_DURATION = 0.15; // s
export const DASH_COOLDOWN = 0.8; // s

// --- Enemies ---
export const ENEMY_SEPARATION_RADIUS = 26; // px: enemies within this push apart
export const ENEMY_SEPARATION_FORCE = 90; // px/s steering to avoid stacking

// --- Waves ---
export const WAVE_BUDGET_BASE = 4;
export const WAVE_BUDGET_GROWTH = 3; // added per wave index
export const WAVE_SPAWN_INTERVAL = 0.45; // s between spawns within a wave
export const WAVE_INTERMISSION = 6; // s of calm between waves
export const BRUTE_MIN_WAVE = 3; // brutes only from this wave on
