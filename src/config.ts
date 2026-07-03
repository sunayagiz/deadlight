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

// --- COD-Zombies-style per-wave scaling ---
// Zombies never idle — the flow field already routes every one to the nearest
// player — so difficulty rides on HP (the signature bullet-sponge ramp), speed,
// and a max-alive cap that turns big waves into a relentless advancing stream.
export const ENEMY_HP_LINEAR = 0.18; // +18% of base HP per wave through the linear phase
export const ENEMY_HP_EXP_WAVE = 9; // HP compounds after this wave (COD: round 10+)
export const ENEMY_HP_EXP = 1.1; // ×1.1 per wave past the threshold — exponential
export const BOSS_HP_SCALE_FRAC = 0.5; // bosses take half the per-wave HP ramp (already tanky)
export const ENEMY_SPEED_PER_WAVE = 0.035; // +3.5% move speed per wave (walkers → sprinters)
export const ENEMY_SPEED_SCALE_MAX = 1.6; // speed cap so they stay catchable/kite-able
export const MAX_ALIVE_BASE = 30; // concurrent enemy cap, solo (relentless stream, no lag-bomb)
export const MAX_ALIVE_PER_PLAYER = 8; // +this many to the cap per extra player

// --- COD-Zombies layer ---
export const CASH_PER_HIT = 10; // COD: +10 points for a non-lethal damaging hit
export const INTERACT_RADIUS = 90; // px: how close a player must be to use a buyable
export const COST_MYSTERY_BOX = 950; // COD Mystery Box spin
export const COST_MYSTERY_BOX_FIRESALE = 10; // Fire Sale price
export const COST_PACK_A_PUNCH = 5000; // COD Pack-a-Punch
export const COST_POWER = 0; // power switch is free to flip (a lever, not a purchase)
export const BOX_TEDDY_MIN_USES = 3; // earliest spin the teddy can relocate the box
export const BOX_TEDDY_CHANCE = 0.28; // per-spin chance (after the minimum) the box moves
export const PAP_DMG_MULT = 2.0; // Pack-a-Punch damage multiplier
export const PAP_AMMO_MULT = 2.0; // Pack-a-Punch reserve-ammo multiplier
export const POWERUP_DROP_CHANCE = 0.03; // per kill chance to drop a power-up
export const POWERUP_TTL = 18; // seconds a dropped power-up lasts
export const POWERUP_MAX_ALIVE = 3; // cap concurrent drops (COD ~4/round)
export const POWERUP_EFFECT_TIME = 30; // Insta-Kill / Double Points / Fire Sale duration
export const NUKE_CASH = 400; // Nuke bonus to the squad
export const DOG_ROUND_FIRST = 5; // earliest wave a hellhound round can occur
export const DOG_ROUND_EVERY = 5; // roughly every Nth wave after that
export const NOTICE_TIME = 2.6; // seconds an announcer line stays on screen

// --- Run goal / extraction (win condition) ---
export const EXTRACTION_WAVE = 20; // the final wave: reach + hold the exit to escape
export const EXTRACT_HOLD = 14; // s a standing player must hold the extraction point
export const EXTRACT_RADIUS = 110; // px radius of the extraction zone

// --- Economy (between-wave shop) ---
export const CASH_PER_KILL = 7; // base cash per kill, scaled by the enemy's budget cost
export const CASH_BOSS = 240; // flat bounty for downing a boss

// --- Perks (in-run roguelite drafting) ---
export const PERK_INTERVAL = 3; // offer a perk draft after every Nth wave cleared
export const PERK_MAX_LEVEL = 5; // stack cap per perk
export const PERK_CHOICES = 3; // options shown per draft
