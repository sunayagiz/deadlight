import { PLAYER_MAX_HP, WAVE_INTERMISSION } from '../config';
import type { Door, GameState, Interactable, PlayerInput, PlayerState, SpawnZone, Wall } from './types';

export function createPlayer(x: number, y: number): PlayerState {
  return {
    pos: { x, y },
    vel: { x: 0, y: 0 },
    aimAngle: 0,
    hp: PLAYER_MAX_HP,
    weapon: 'pistol',
    owned: ['pistol', 'katana'], // start with a sidearm and a blade; find the rest as loot
    ammo: {},
    spin: 0,
    meleeSwing: 0,
    fireCooldown: 0,
    dash: { timeLeft: 0, cooldownLeft: 0, dirX: 1, dirY: 0 },
    alive: true,
    downed: false,
    bleedout: 0,
    reviveProgress: 0,
  };
}

export function createGameState(
  walls: Wall[],
  spawnZones: SpawnZone[] = [],
  doors: Door[] = [],
  playerStart: { x: number; y: number } = { x: 480, y: 270 },
  dims: { width: number; height: number } = { width: 960, height: 540 },
  numPlayers = 1,
  extractPoint: { x: number; y: number } = { x: dims.width - 220, y: dims.height - 220 },
  interactables: Interactable[] = [],
): GameState {
  // fan the co-op squad out slightly around the start so they don't stack
  const players = Array.from({ length: Math.max(1, numPlayers) }, (_, i) => {
    const a = (i / 4) * Math.PI * 2;
    return createPlayer(playerStart.x + Math.cos(a) * 26 * (i > 0 ? 1 : 0), playerStart.y + Math.sin(a) * 26 * (i > 0 ? 1 : 0));
  });
  return {
    time: 0,
    mapW: dims.width,
    mapH: dims.height,
    players,
    player: players[0],
    bullets: [],
    nextBulletId: 1,
    enemies: [],
    nextEnemyId: 1,
    loot: [],
    nextLootId: 1,
    wave: {
      index: 1,
      phase: 'intermission', // start with a short breather before wave 1
      timer: WAVE_INTERMISSION,
      spawnQueue: [],
      spawnCooldown: 0,
      killsThisWave: 0,
      spawnCursor: 0,
    },
    spawnZones: [...spawnZones],
    walls: [...walls], // copy: each GameState must be an independent snapshot (netcode)
    doors: doors.map((d) => ({ ...d })),
    gameOver: false,
    won: false,
    cash: 0,
    perks: {},
    perkDraft: null,
    extractPoint: { ...extractPoint },
    extraction: null,
    interactables: interactables.map((it) => ({ ...it })),
    powerups: [],
    nextPowerUpId: 1,
    powerOn: false,
    instaKillT: 0,
    doublePtsT: 0,
    fireSaleT: 0,
    packed: {},
    dogRound: false,
    notice: '',
    noticeT: 0,
    boxReveal: null,
  };
}

export function emptyInput(): PlayerInput {
  return {
    moveX: 0,
    moveY: 0,
    aimWorldX: 0,
    aimWorldY: 0,
    fire: false,
    dash: false,
    sprint: false,
    weaponSlot: -1,
    weaponCycle: 0,
    buy: -1,
    perk: -1,
    use: false,
  };
}
