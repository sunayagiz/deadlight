import { updateBosses } from './bosses';
import { updateCodTimers, updateInteractions, updatePowerups } from './cod';
import { updateCombat } from './combat';
import { updateRevives } from './coop';
import { enemySpeedScale, updateEnemies, updateRangedEnemies } from './enemies';
import { updateExtraction } from './extraction';
import { getFlowField } from './flowfield';
import { updateLoot } from './loot';
import { mapSolids, updateDoors } from './map';
import { updateMelee } from './melee';
import { updateDash, updateMovement } from './movement';
import { banishPerk, choosePerk, effectiveMaxHp, regenPerSec, rerollDraft, speedMult } from './perks';
import { buy } from './shop';
import { updateWaves, type Rng } from './waves';
import { cycleWeapon, equipWeapon, updateAim, updateBullets, updateFiring } from './weapons';
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

  updateCodTimers(state, dt); // Insta-Kill / Double Points / Fire Sale / notice timers
  updateDoors(state);
  const solids = mapSolids(state); // walls + still-closed doors
  const flow = getFlowField(state, solids); // multi-source: routes enemies to the nearest player

  const spd = speedMult(state);
  const regen = regenPerSec(state);
  const intermission = state.wave.phase === 'intermission';

  // Each standing player acts on their own input; downed/dead players are inert.
  state.players.forEach((p, i) => {
    if (!isUp(p)) return;
    const input = list[i] ?? emptyInput();
    // weapon switching flows through input so it's netcode-safe (guests too)
    if (input.weaponSlot >= 0 && input.weaponSlot < p.owned.length) equipWeapon(p, p.owned[input.weaponSlot]);
    if (input.weaponCycle !== 0) cycleWeapon(p, input.weaponCycle);
    updateDash(p, input, dt);
    updateMovement(p, input, solids, dt, spd);
    updateAim(p, input);
    updateFiring(state, p, input, dt, rng);
    updateMelee(state, p, input, dt);
    // perk regen (never past the effective cap)
    if (regen > 0 && p.hp > 0) p.hp = Math.min(effectiveMaxHp(state), p.hp + regen * dt);
    // between-wave shop + perk draft (host-authoritative via input)
    if (intermission) {
      if (input.buy >= 0) buy(state, i, input.buy);
      // draft agency (host-authoritative): banish/reroll resolve before a pick so
      // a player can shape the options in the same tick they act on them
      if (input.banish >= 0 && state.perkDraft) banishPerk(state, input.banish, rng);
      if (input.reroll && state.perkDraft) rerollDraft(state, rng);
      if (input.perk >= 0 && state.perkDraft) choosePerk(state, input.perk);
    }
  });

  updateInteractions(state, list, rng); // pay-doors + Mystery Box / PaP / wall / power
  updateRevives(state, list, dt); // bleedout + teammate revives
  updateEnemies(state.enemies, state.players, solids, dt, flow, enemySpeedScale(state.wave.index));
  updateRangedEnemies(state, dt); // spitters lob acid
  updateBosses(state, dt, rng);
  updateBullets(state, dt);
  updateCombat(state, dt, rng);
  updatePowerups(state, dt); // pick up dropped power-ups
  updateLoot(state, dt);
  updateWaves(state, dt, rng, flow); // flow gates spawns to reachable (opened) rooms
  updateExtraction(state, dt); // final-wave escape objective / win condition

  if (state.players.every((p) => !p.alive)) state.gameOver = true; // whole squad down
}
