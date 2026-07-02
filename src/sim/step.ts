import { updateBosses } from './bosses';
import { updateCombat } from './combat';
import { updateEnemies } from './enemies';
import { getFlowField } from './flowfield';
import { updateLoot } from './loot';
import { mapSolids, updateDoors } from './map';
import { updateMelee } from './melee';
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

  updateDoors(state);
  const solids = mapSolids(state); // walls + still-closed doors
  const flow = getFlowField(state, solids); // cached: recomputes on cell/door change

  updateDash(state.player, input, dt);
  updateMovement(state.player, input, solids, dt);
  updateAim(state.player, input);
  updateFiring(state, input, dt, rng);
  updateEnemies(state.enemies, state.player, solids, dt, flow);
  updateBosses(state, dt, rng);
  updateMelee(state, input, dt);
  updateBullets(state, dt);
  updateCombat(state, dt, rng);
  updateLoot(state, dt);
  updateWaves(state, dt, rng);
}
