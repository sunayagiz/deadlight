import {
  DASH_COOLDOWN,
  DASH_DURATION,
  DASH_SPEED,
  PLAYER_RADIUS,
  PLAYER_SPEED,
} from '../config';
import { norm } from './vec';
import type { PlayerInput, PlayerState, Wall } from './types';

function hitWall(x: number, y: number, walls: Wall[]): Wall | undefined {
  return walls.find(
    (w) =>
      x + PLAYER_RADIUS > w.x &&
      x - PLAYER_RADIUS < w.x + w.w &&
      y + PLAYER_RADIUS > w.y &&
      y - PLAYER_RADIUS < w.y + w.h,
  );
}

export function updateMovement(
  p: PlayerState,
  input: PlayerInput,
  walls: Wall[],
  dt: number,
): void {
  if (p.dash.timeLeft > 0) {
    p.vel = { x: p.dash.dirX * DASH_SPEED, y: p.dash.dirY * DASH_SPEED };
  } else {
    const dir = norm({ x: input.moveX, y: input.moveY });
    p.vel = { x: dir.x * PLAYER_SPEED, y: dir.y * PLAYER_SPEED };
  }

  // Per-axis integration: blocked axis clamps to the wall face, free axis keeps moving (wall slide).
  let nx = p.pos.x + p.vel.x * dt;
  const wx = hitWall(nx, p.pos.y, walls);
  if (wx) nx = p.vel.x > 0 ? wx.x - PLAYER_RADIUS : wx.x + wx.w + PLAYER_RADIUS;
  p.pos.x = nx;

  let ny = p.pos.y + p.vel.y * dt;
  const wy = hitWall(p.pos.x, ny, walls);
  if (wy) ny = p.vel.y > 0 ? wy.y - PLAYER_RADIUS : wy.y + wy.h + PLAYER_RADIUS;
  p.pos.y = ny;
}

export function updateDash(p: PlayerState, input: PlayerInput, dt: number): void {
  p.dash.timeLeft = Math.max(0, p.dash.timeLeft - dt);
  p.dash.cooldownLeft = Math.max(0, p.dash.cooldownLeft - dt);

  if (input.dash && p.dash.timeLeft === 0 && p.dash.cooldownLeft === 0) {
    const dir = norm({ x: input.moveX, y: input.moveY });
    if (dir.x === 0 && dir.y === 0) {
      p.dash.dirX = Math.cos(p.aimAngle);
      p.dash.dirY = Math.sin(p.aimAngle);
    } else {
      p.dash.dirX = dir.x;
      p.dash.dirY = dir.y;
    }
    p.dash.timeLeft = DASH_DURATION;
    p.dash.cooldownLeft = DASH_COOLDOWN;
  }
}

/** i-frames: the player cannot take damage while dashing. Used by combat in slice 2. */
export function isInvulnerable(p: PlayerState): boolean {
  return p.dash.timeLeft > 0;
}
