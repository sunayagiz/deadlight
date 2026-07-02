import { updateCombat } from './combat';
import { updateEnemies } from './enemies';
import { updateDash, updateMovement } from './movement';
import { updateWaves, type Rng } from './waves';
import { updateAim, updateBullets, updateFiring } from './weapons';
import type { GameState, PlayerInput } from './types';

/** One fixed simulation tick. System order is part of the contract — do not reorder casually. */
export function stepSim(
  state: GameState,
  input: PlayerInput,
  dt: number,
  rng: Rng = Math.random,
): void {
  state.time += dt;
  if (state.gameOver) return; // freeze the world on death; the scene shows the end state

  updateDash(state.player, input, dt);
  updateMovement(state.player, input, state.walls, dt);
  updateAim(state.player, input);
  updateFiring(state, input, dt);
  updateEnemies(state.enemies, state.player, state.walls, dt);
  updateBullets(state, dt);
  updateCombat(state, dt);
  updateWaves(state, dt, rng);
}
