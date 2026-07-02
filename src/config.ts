/** All feel/tuning constants. Tune here, nowhere else. */
export const SIM_DT = 1 / 60; // fixed simulation timestep (seconds)

export const PLAYER_SPEED = 240; // px/s
export const SPRINT_MULT = 1.45; // hold Shift
export const PLAYER_RADIUS = 14;
export const PLAYER_MAX_HP = 100;

export const BULLET_KNOCKBACK = 26; // px shove on a standard-radius enemy per hit

// --- Co-op ---
export const MAX_PLAYERS = 4;
export const REVIVE_RADIUS = 56; // px: a standing teammate this close revives a downed one
export const REVIVE_TIME = 2.4; // s of proximity to fully revive
export const REVIVE_HP = 45; // hp restored on revive
export const BLEEDOUT_TIME = 24; // s a downed player survives before dying

export const DASH_SPEED = 640; // px/s
export const DASH_DURATION = 0.15; // s
export const DASH_COOLDOWN = 0.8; // s

// --- Enemies ---
export const ENEMY_SEPARATION_RADIUS = 26; // px: enemies within this push apart
export const ENEMY_SEPARATION_FORCE = 90; // px/s steering to avoid stacking

// --- Waves ---
export const WAVE_BUDGET_BASE = 12; // bigger map wants a denser horde
export const WAVE_BUDGET_GROWTH = 6; // added per wave index
export const WAVE_SPAWN_INTERVAL = 0.28; // s between spawns within a wave
export const WAVE_INTERMISSION = 6; // s of calm between waves
export const BRUTE_MIN_WAVE = 3; // brutes only from this wave on

// --- Loot ---
export const LOOT_DROP_CHANCE = 0.22; // chance a killed enemy drops something
export const LOOT_TTL = 15; // s before a dropped item despawns
export const LOOT_RADIUS = 12; // px pickup range (plus the player radius)

// --- Bosses ---
export const BOSS_WAVE_INTERVAL = 4; // a boss shows up every Nth wave (4, 8, 12, ...)
export const BOSS_TELEGRAPH = 0.7; // s of wind-up before an attack lands
export const BOSS_ATTACK_CD = 2.6; // s between boss attacks
export const BOSS_SUMMON_COUNT = 3; // adds summoned per screamer summon

// --- Doors & vision ---
export const DOOR_OPEN_RADIUS = 46; // px: doors swing open when the player gets this close
export const FLASHLIGHT_RANGE = 340; // px reach of the flashlight cone
export const FLASHLIGHT_HALF_ANGLE = 0.62; // radians: half-width of the cone (~35°)
export const AMBIENT_RADIUS = 70; // px of dim light around the player regardless of aim

// --- Spawning (L4D-style: never in the player's face) ---
export const SPAWN_MIN_DIST = 300; // px: never spawn closer than this to a player
export const SPAWN_SIGHT_DIST = 1.6; // × FLASHLIGHT_RANGE: inside this + in cone + clear LOS = rejected
export const SPAWN_RETRY = 0.2; // s before retrying when no valid zone exists

// --- Flow field pathfinding ---
export const FLOW_CELL = 40; // px grid cell for the zombie flow field
