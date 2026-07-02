import { PLAYER_RADIUS } from '../config';
import { ZOMBIES } from './enemies';
import { isInvulnerable } from './movement';
import type { GameState } from './types';

const HIT_FLASH = 0.08; // seconds an enemy flashes white after taking a hit

/**
 * Resolve all damage for one tick. Runs after movement so it uses final
 * positions. Order: bullets hurt enemies, dead enemies are cleared, then
 * living enemies deal contact damage to a non-dashing player.
 */
export function updateCombat(state: GameState, dt: number): void {
  // Bullets vs enemies: a bullet is consumed by the first enemy it overlaps.
  const surviving = [];
  for (const b of state.bullets) {
    let consumed = false;
    for (const e of state.enemies) {
      if (e.hp <= 0) continue;
      const r = ZOMBIES[e.type].radius;
      const dx = b.pos.x - e.pos.x;
      const dy = b.pos.y - e.pos.y;
      if (dx * dx + dy * dy <= r * r) {
        e.hp -= b.damage;
        e.hitFlash = HIT_FLASH;
        consumed = true;
        break;
      }
    }
    if (!consumed) surviving.push(b);
  }
  state.bullets = surviving;

  // Clear the dead and tally kills for the HUD / wave tracking.
  const before = state.enemies.length;
  state.enemies = state.enemies.filter((e) => e.hp > 0);
  state.wave.killsThisWave += before - state.enemies.length;

  // Enemy contact damage (DPS) — dash i-frames make the player immune.
  const p = state.player;
  if (p.hp > 0 && !isInvulnerable(p)) {
    for (const e of state.enemies) {
      const def = ZOMBIES[e.type];
      const rr = def.radius + PLAYER_RADIUS;
      const dx = p.pos.x - e.pos.x;
      const dy = p.pos.y - e.pos.y;
      if (dx * dx + dy * dy <= rr * rr) {
        p.hp -= def.contactDamage * dt;
      }
    }
  }

  if (p.hp <= 0) {
    p.hp = 0;
    state.gameOver = true;
  }
}
