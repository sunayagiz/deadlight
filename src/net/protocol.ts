import type {
  BulletState,
  EnemyState,
  ExtractionState,
  GameState,
  Interactable,
  LootState,
  PingState,
  PlayerState,
  PowerUp,
  WaveState,
  WeaponId,
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
  pings: PingState[]; // active co-op pings
  npi: number; // nextPingId
  doors: boolean[]; // open flags, index-aligned with state.doors
  wave: WaveState;
  nb: number; // nextBulletId
  ne: number;
  nl: number;
  won: boolean;
  tk: number; // totalKills (co-op score display)
  cash: number;
  perks: Record<string, number>;
  draft: string[] | null; // perkDraft
  rr: number; // rerollCount (drives the reroll cost on guests)
  ban: string[]; // banished perk ids
  extract: ExtractionState | null;
  inter: Interactable[]; // buyables (mystery box moves, so send them)
  pups: PowerUp[];
  power: boolean;
  ik: number; // instaKillT
  dp: number; // doublePtsT
  fs: number; // fireSaleT
  packed: Record<string, boolean>;
  dog: boolean;
  notice: string;
  noticeT: number;
  boxR: { weapon: WeaponId; t: number } | null;
}

export function snapshot(s: GameState): Snapshot {
  return {
    t: s.time,
    over: s.gameOver,
    players: s.players,
    enemies: s.enemies,
    bullets: s.bullets,
    loot: s.loot,
    pings: s.pings,
    npi: s.nextPingId,
    doors: s.doors.map((d) => d.open),
    wave: s.wave,
    nb: s.nextBulletId,
    ne: s.nextEnemyId,
    nl: s.nextLootId,
    won: s.won,
    tk: s.totalKills,
    cash: s.cash,
    perks: s.perks,
    draft: s.perkDraft,
    rr: s.rerollCount,
    ban: s.banished,
    extract: s.extraction,
    inter: s.interactables,
    pups: s.powerups,
    power: s.powerOn,
    ik: s.instaKillT,
    dp: s.doublePtsT,
    fs: s.fireSaleT,
    packed: s.packed,
    dog: s.dogRound,
    notice: s.notice,
    noticeT: s.noticeT,
    boxR: s.boxReveal,
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
  s.pings = snap.pings;
  s.nextPingId = snap.npi;
  snap.doors.forEach((open, i) => {
    if (s.doors[i]) s.doors[i].open = open;
  });
  s.wave = snap.wave;
  s.nextBulletId = snap.nb;
  s.nextEnemyId = snap.ne;
  s.nextLootId = snap.nl;
  s.won = snap.won;
  s.totalKills = snap.tk;
  s.cash = snap.cash;
  s.perks = snap.perks;
  s.perkDraft = snap.draft;
  s.rerollCount = snap.rr;
  s.banished = snap.ban;
  s.extraction = snap.extract;
  s.interactables = snap.inter;
  s.powerups = snap.pups;
  s.powerOn = snap.power;
  s.instaKillT = snap.ik;
  s.doublePtsT = snap.dp;
  s.fireSaleT = snap.fs;
  s.packed = snap.packed;
  s.dogRound = snap.dog;
  s.notice = snap.notice;
  s.noticeT = snap.noticeT;
  s.boxReveal = snap.boxR;
}

// Wire messages
export type NetMsg =
  | { t: 'welcome'; you: number } // host tells a guest its player slot
  | { t: 'start'; players: number } // host started the match
  | { t: 'snap'; s: Snapshot } // host→guest per-tick state
  | { t: 'input'; i: import('../sim/types').PlayerInput }; // guest→host per-tick intent
