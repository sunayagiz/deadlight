import { PLAYER_MAX_HP } from '../config';
import type { GameState, PlayerInput, PlayerState, Wall } from './types';

export function createPlayer(x: number, y: number): PlayerState {
  return {
    pos: { x, y },
    vel: { x: 0, y: 0 },
    aimAngle: 0,
    hp: PLAYER_MAX_HP,
    weapon: 'pistol',
    fireCooldown: 0,
    dash: { timeLeft: 0, cooldownLeft: 0, dirX: 1, dirY: 0 },
  };
}

export function createGameState(walls: Wall[]): GameState {
  return {
    time: 0,
    player: createPlayer(480, 270),
    bullets: [],
    nextBulletId: 1,
    walls,
  };
}

export function emptyInput(): PlayerInput {
  return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, dash: false };
}
