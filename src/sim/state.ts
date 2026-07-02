import { PLAYER_MAX_HP, WAVE_INTERMISSION } from '../config';
import type { GameState, PlayerInput, PlayerState, SpawnZone, Wall } from './types';

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
  };
}

export function createGameState(walls: Wall[], spawnZones: SpawnZone[] = []): GameState {
  return {
    time: 0,
    player: createPlayer(480, 270),
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
    },
    spawnZones: [...spawnZones],
    walls: [...walls], // copy: each GameState must be an independent snapshot (netcode)
    gameOver: false,
  };
}

export function emptyInput(): PlayerInput {
  return { moveX: 0, moveY: 0, aimWorldX: 0, aimWorldY: 0, fire: false, dash: false };
}
