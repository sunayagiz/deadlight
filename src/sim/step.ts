import { updateBosses } from './bosses';
import { updateCombat } from './combat';
import { updateRevives } from './coop';
import { updateEnemies } from './enemies';
import { getFlowField } from './flowfield';
import { updateLoot } from './loot';
import { mapSolids, updateDoors } from './map';
import { updateMelee } from './melee';
import { updateDash, updateMovement } from './movement';
import { updateWaves, type Rng } from './waves';
import { updateAim, updateBullets, updateFiring } from './weapons';
import { emptyInput } from './state';
import { isUp, type GameState, type PlayerInput } from './types';

/**
 * One fixed simulation tick. Host-authoritative: `inputs[i]` is player i's
 * intent. Solo play passes a single-element array. System order is part of the
 * contract — do not reorder casually.
 */
export function stepSim(
  state: GameState,
  inputs: PlayerInput | PlayerInput[],
  dt: number,
  rng: Rng = Math.random,
): void {
  const list = Array.isArray(inputs) ? inputs : [inputs]; // back-compat with solo callers
  state.time += dt;
  state.player = state.players[0]; // keep the solo/host alias live
  if (state.gameOver) return; // freeze the world on death; the scene shows the end state

  updateDoors(state);
  const solids = mapSolids(state); // walls + still-closed doors
  const flow = getFlowField(state, solids); // multi-source: routes enemies to the nearest player

  // Each standing player acts on their own input; downed/dead players are inert.
  state.players.forEach((p, i) => {
    if (!isUp(p)) return;
    const input = list[i] ?? emptyInput();
    updateDash(p, input, dt);
    updateMovement(p, input, solids, dt);
    updateAim(p, input);
    updateFiring(state, p, input, dt, rng);
    updateMelee(state, p, input, dt);
  });

  updateRevives(state, list, dt); // bleedout + teammate revives
  updateEnemies(state.enemies, state.players, solids, dt, flow);
  updateBosses(state, dt, rng);
  updateBullets(state, dt);
  updateCombat(state, dt, rng);
  updateLoot(state, dt);
  updateWaves(state, dt, rng);

  if (state.players.every((p) => !p.alive)) state.gameOver = true; // whole squad down
}
