import { BLEEDOUT_TIME, REVIVE_HP, REVIVE_RADIUS, REVIVE_TIME } from '../config';
import { isUp, type GameState, type PlayerInput, type PlayerState } from './types';

/** Put a player into the downed state (lethal hit) instead of killing outright. */
export function downPlayer(p: PlayerState): void {
  if (p.downed || !p.alive) return;
  p.downed = true;
  p.hp = 0;
  p.bleedout = BLEEDOUT_TIME;
  p.reviveProgress = 0;
  p.vel = { x: 0, y: 0 };
}

/**
 * Bleedout + revive. A downed player dies when the timer runs out; a standing
 * teammate within REVIVE_RADIUS (and not firing) fills the revive bar, and at
 * full it stands them back up with REVIVE_HP.
 */
export function updateRevives(state: GameState, inputs: PlayerInput[], dt: number): void {
  const players = state.players;
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
      if (p.reviveProgress >= 1) {
        p.downed = false;
        p.reviveProgress = 0;
        p.hp = REVIVE_HP;
      }
    } else {
      p.reviveProgress = Math.max(0, p.reviveProgress - dt / REVIVE_TIME); // decays when left alone
      p.bleedout -= dt;
      if (p.bleedout <= 0) p.alive = false; // bled out
    }
  }
}
