import { updateDash, updateMovement } from './movement';
import { updateAim, updateBullets, updateFiring } from './weapons';
import type { GameState, PlayerInput } from './types';

/** One fixed simulation tick. System order is part of the contract — do not reorder casually. */
export function stepSim(state: GameState, input: PlayerInput, dt: number): void {
  state.time += dt;
  updateDash(state.player, input, dt);
  updateMovement(state.player, input, state.walls, dt);
  updateAim(state.player, input);
  updateFiring(state, input, dt);
  updateBullets(state, dt);
}
