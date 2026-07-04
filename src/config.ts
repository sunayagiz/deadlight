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
export const DOWNED_CRAWL_SPEED = 90; // px/s a downed (but alive) player can crawl toward safety — defenseless, no sprint/dash
// Solo self-revive (COD "Quick Revive"): a solo run no longer ends on the first
// lethal hit — the player goes down and, if a charge remains, revives themselves.
export const SELF_REVIVE_CHARGES = 2; // self-revives available on a solo run
export const SELF_REVIVE_TIME = 4; // s a downed solo player takes to self-revive

export const DASH_SPEED = 640; // px/s
export const DASH_DURATION = 0.15; // s
export const DASH_COOLDOWN = 0.8; // s

// --- Enemies ---
export const ENEMY_SEPARATION_RADIUS = 26; // px: enemies within this push apart
export const ENEMY_SEPARATION_FORCE = 90; // px/s steering to avoid stacking

// --- Waves ---
export const WAVE_BUDGET_BASE = 12; // bigger map wants a denser horde
export const WAVE_BUDGET_GROWTH = 8; // added per wave index (steeper linear ramp — no cliff)
export const WAVE_SPAWN_INTERVAL = 0.26; // s between spawns within a wave
export const WAVE_INTERMISSION = 6; // s of calm between waves (keep — time to buy/reposition)
export const BRUTE_MIN_WAVE = 3; // brutes only from this wave on
export const GUARANTEED_AMMO_EVERY = 5; // drop a Max Ammo every Nth cleared wave (endless sustain)

// --- Special enemy behaviours ---
export const SPITTER_STANDOFF = 240; // px: spitters try to hold this range from a player
export const SPITTER_RANGE = 470; // px: max range they'll lob acid
export const SPITTER_FIRE_CD = 2.4; // s between acid shots
export const SPITTER_ACID_SPEED = 380; // px/s
export const SPITTER_ACID_DMG = 14; // per acid glob
export const SPITTER_ACID_TTL = 2.0; // s
export const BOOMER_BLAST_RADIUS = 95; // px: AoE when a boomer dies
export const BOOMER_BLAST_DMG = 32; // damage to players caught in the blast
export const STALKER_LUNGE_RANGE = 300; // px: within this a stalker may lunge
export const STALKER_LUNGE_CD = 3.2; // s between lunges
export const STALKER_LUNGE_TIME = 0.28; // s the lunge dash lasts
export const STALKER_LUNGE_SPEED = 470; // px/s during a lunge
export const SPAWN_JITTER = 46; // px: random offset around a spawn zone so spawns don't stack
export const ARMOR_MELEE_BONUS = 1.35; // melee damage multiplier vs armored enemies (melee is the answer)

// --- Elite / affix modifiers (RoR2-style) ---
// A fraction of spawned enemies carry an affix (see affix.ts). Chance is zero
// through the early waves, then ramps up with the wave index toward a cap so
// endless late rounds stay fresh without turning into an all-elite meat grinder.
export const AFFIX_MIN_WAVE = 3; // no affixes before this wave (learn the base roster first)
export const AFFIX_CHANCE_BASE = 0.08; // affix chance at AFFIX_MIN_WAVE
export const AFFIX_CHANCE_PER_WAVE = 0.012; // added per wave past AFFIX_MIN_WAVE
export const AFFIX_CHANCE_MAX = 0.35; // cap so most of the horde is still "normal"

// --- Co-op pings (Apex-style coordination) ---
export const PING_TTL = 5; // s a ping marker stays before it fades
export const PING_MAX_PER_PLAYER = 3; // cap concurrent pings per player (spam can't flood)
export const PING_ENEMY_RADIUS = 120; // px: enemy within this of the ping point → 'enemy' ping
export const PING_LOOT_RADIUS = 120; // px: loot within this (and no enemy) → 'loot' ping

// --- Loot ---
export const LOOT_DROP_CHANCE = 0.22; // chance a killed enemy drops something
export const LOOT_TTL = 15; // s before a dropped item despawns
export const LOOT_RADIUS = 12; // px pickup range (plus the player radius)

// --- Bosses ---
export const BOSS_WAVE_INTERVAL = 6; // a boss every Nth wave (less fatigue; offset from dog rounds@5)
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
export const ENEMY_HP_EXP = 1.1; // ×1.1 per wave, waves 10–25 (the fun COD ramp)
// Past this wave, soften the compounding so it doesn't become an unkillable
// bullet-sponge wall — late threat comes from cap growth + speed + enemy MIX.
export const ENEMY_HP_EXP_LATE_WAVE = 25;
export const ENEMY_HP_EXP_LATE = 1.06; // gentler compounding after the late threshold
export const BOSS_HP_SCALE_FRAC = 0.5; // bosses take half the per-wave HP ramp (already tanky)
export const ENEMY_SPEED_PER_WAVE = 0.035; // +3.5% move speed per wave (walkers → sprinters)
export const ENEMY_SPEED_SCALE_MAX = 1.6; // speed cap so they stay catchable/kite-able (≈0.87× walk)
// Concurrent on-screen cap GROWS each wave so late rounds are visibly denser,
// with a browser-safe ceiling (Phaser + flow-field is comfortable to ~55 agents).
export const MAX_ALIVE_BASE = 30; // concurrent enemy cap, solo, wave 1
export const MAX_ALIVE_PER_PLAYER = 8; // +this many to the cap per extra player
export const MAX_ALIVE_PER_WAVE = 1.5; // +this many to the cap per wave cleared
export const MAX_ALIVE_CEIL = 55; // hard ceiling (perf + fairness)

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
export const POWERUP_DROP_CHANCE = 0.04; // per kill chance to drop a power-up (ammo sustain for long runs)
export const POWERUP_TTL = 18; // seconds a dropped power-up lasts
export const POWERUP_MAX_ALIVE = 3; // cap concurrent drops (COD ~4/round)
export const POWERUP_EFFECT_TIME = 30; // Insta-Kill / Double Points / Fire Sale duration
export const NUKE_CASH = 400; // Nuke bonus to the squad
export const DOG_ROUND_FIRST = 5; // earliest wave a hellhound round can occur
export const DOG_ROUND_EVERY = 5; // roughly every Nth wave after that
export const NOTICE_TIME = 2.6; // seconds an announcer line stays on screen

// --- Endless survival ---
// No win condition: waves continue forever, each round harder. The old extraction
// exit is pushed out of reach (9999) so the run only ends when the squad falls.
export const EXTRACTION_WAVE = 9999; // effectively unreachable → endless mode
export const EXTRACT_HOLD = 14; // s a standing player must hold the extraction point
export const EXTRACT_RADIUS = 110; // px radius of the extraction zone

// --- Economy (between-wave shop) ---
export const CASH_PER_KILL = 7; // base cash per kill, scaled by the enemy's budget cost
export const CASH_BOSS = 240; // flat bounty for downing a boss

// --- Perks (in-run roguelite drafting) ---
export const PERK_INTERVAL = 3; // offer a perk draft after every Nth wave cleared
export const PERK_MAX_LEVEL = 5; // stack cap per perk
export const PERK_CHOICES = 3; // options shown per draft
// Draft agency (Brotato-style): pay to reroll the offered options or banish a
// perk from the run's pool entirely. Reroll gets pricier each time within the
// SAME draft (rerollCount resets when a new draft opens); banish is a flat cost.
export const REROLL_BASE = 150; // cash for the first reroll of a draft
export const REROLL_STEP = 150; // added per reroll already spent this draft (150 → 300 → 450 …)
export const BANISH_COST = 250; // cash to permanently remove a perk from the run's pool
