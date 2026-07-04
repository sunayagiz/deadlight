import {
  BLEEDOUT_TIME,
  REVIVE_HP,
  REVIVE_RADIUS,
  REVIVE_TIME,
  SELF_REVIVE_TIME,
} from '../config';
import { isUp, type GameState, type PlayerInput, type PlayerState } from './types';

/** Put a player into the downed state (lethal hit) instead of killing outright. */
export function downPlayer(p: PlayerState): void {
  if (p.downed || !p.alive) return;
  p.downed = true;
  p.hp = 0;
  p.bleedout = BLEEDOUT_TIME;
  p.reviveProgress = 0;
  p.vel = { x: 0, y: 0 };
  p.dash.timeLeft = 0; // no dash i-frames while crawling — stay defenseless
}

/** Stand a downed player back up with a bit of health. */
function reviveUp(p: PlayerState): void {
  p.downed = false;
  p.reviveProgress = 0;
  p.hp = REVIVE_HP;
}

/**
 * Bleedout + revive. A downed player dies when the timer runs out.
 * - Co-op: a standing teammate within REVIVE_RADIUS (and not firing) fills the
 *   revive bar; at full they stand back up with REVIVE_HP.
 * - Solo: a "Quick Revive" charge lets the player revive themselves over
 *   SELF_REVIVE_TIME, spending one charge. With no charges left they bleed out.
 */
export function updateRevives(state: GameState, inputs: PlayerInput[], dt: number): void {
  const players = state.players;
  const solo = players.length <= 1; // a true solo run — no teammate can ever reach them
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p.downed || !p.alive) continue;

    // any standing teammate nearby who isn't shooting counts as reviving
    const reviver = players.some((q, j) => {
      if (j === i || !isUp(q)) return false;
      const firing = inputs[j]?.fire ?? false;
      const dx = q.pos.x - p.pos.x;
      const dy = q.pos.y - p.pos.y;
      return !firing && dx * dx + dy * dy <= REVIVE_RADIUS * REVIVE_RADIUS;
    });

    if (reviver) {
      p.reviveProgress += dt / REVIVE_TIME;
      if (p.reviveProgress >= 1) reviveUp(p);
    } else if (solo && p.selfReviveCharges > 0) {
      // Quick Revive: pick yourself up, slower than a teammate would, once per charge
      p.reviveProgress += dt / SELF_REVIVE_TIME;
      if (p.reviveProgress >= 1) {
        p.selfReviveCharges -= 1;
        reviveUp(p);
      }
    } else {
      p.reviveProgress = Math.max(0, p.reviveProgress - dt / REVIVE_TIME); // decays when left alone
      p.bleedout -= dt;
      if (p.bleedout <= 0) p.alive = false; // bled out
    }
  }
}
