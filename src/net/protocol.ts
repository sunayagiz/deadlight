import type {
  BulletState,
  EnemyState,
  ExtractionState,
  GameState,
  LootState,
  PlayerState,
  WaveState,
} from '../sim/types';

/**
 * Host→guest snapshot: only the DYNAMIC state. Walls/spawn zones/map size are
 * static and identical on both ends (both call buildMap()), so they're never
 * sent — keeping messages small enough to broadcast every tick.
 */
export interface Snapshot {
  t: number; // sim time
  over: boolean;
  players: PlayerState[];
  enemies: EnemyState[];
  bullets: BulletState[];
  loot: LootState[];
  doors: boolean[]; // open flags, index-aligned with state.doors
  wave: WaveState;
  nb: number; // nextBulletId
  ne: number;
  nl: number;
  won: boolean;
  cash: number;
  perks: Record<string, number>;
  draft: string[] | null; // perkDraft
  extract: ExtractionState | null;
}

export function snapshot(s: GameState): Snapshot {
  return {
    t: s.time,
    over: s.gameOver,
    players: s.players,
    enemies: s.enemies,
    bullets: s.bullets,
    loot: s.loot,
    doors: s.doors.map((d) => d.open),
    wave: s.wave,
    nb: s.nextBulletId,
    ne: s.nextEnemyId,
    nl: s.nextLootId,
    won: s.won,
    cash: s.cash,
    perks: s.perks,
    draft: s.perkDraft,
    extract: s.extraction,
  };
}

/** Apply a snapshot onto a guest's local state (which already holds the static map). */
export function applySnapshot(s: GameState, snap: Snapshot): void {
  s.time = snap.t;
  s.gameOver = snap.over;
  s.players = snap.players;
  s.player = snap.players[0];
  s.enemies = snap.enemies;
  s.bullets = snap.bullets;
  s.loot = snap.loot;
  snap.doors.forEach((open, i) => {
    if (s.doors[i]) s.doors[i].open = open;
  });
  s.wave = snap.wave;
  s.nextBulletId = snap.nb;
  s.nextEnemyId = snap.ne;
  s.nextLootId = snap.nl;
  s.won = snap.won;
  s.cash = snap.cash;
  s.perks = snap.perks;
  s.perkDraft = snap.draft;
  s.extraction = snap.extract;
}

// Wire messages
export type NetMsg =
  | { t: 'welcome'; you: number } // host tells a guest its player slot
  | { t: 'start'; players: number } // host started the match
  | { t: 'snap'; s: Snapshot } // host→guest per-tick state
  | { t: 'input'; i: import('../sim/types').PlayerInput }; // guest→host per-tick intent
