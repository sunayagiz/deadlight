import { updateBosses } from './bosses';
import { updateCodTimers, updateInteractions, updatePowerups } from './cod';
import { updateCombat } from './combat';
import { placeDeployables, updateBarricadeAttacks, updateTraps } from './deployables';
import { updateDirector } from './director';
import { updateRevives } from './coop';
import { enemySpeedScale, updateEnemies, updateRangedEnemies } from './enemies';
import { updateDefend, updateExtraction } from './extraction';
import { getFlowField } from './flowfield';
import { updateLoot } from './loot';
import { mapSolids, updateDoors } from './map';
import { updateMelee } from './melee';
import { updatePings } from './ping';
import { updateCrawl, updateDash, updateMovement } from './movement';
import { banishPerk, choosePerk, effectiveMaxHp, regenPerSec, rerollDraft, speedMult } from './perks';
import { buy } from './shop';
import { updateWaves, type Rng } from './waves';
import { cycleWeapon, equipWeapon, updateAim, updateBullets, updateFiring } from './weapons';
import { emptyInput } from './state';
import { DEFEND_WAVES, ZED_DRAIN_PER_SEC, ZED_DURATION, ZED_TIMESCALE } from '../config';
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

  // ── A9: Zed-Time (shared slow-mo) ──────────────────────────────────────────
  // The window counts down in REAL (unscaled) time, then any UP player can pop a
  // full meter to re-arm it. Deterministic (dt-driven, no wall-clock). A full,
  // banked meter never bleeds — so an activation is always honoured — but partial
  // progress drains so it can't be trickled to full over a long lull.
  if (state.zedTime > 0) state.zedTime = Math.max(0, state.zedTime - dt);
  const triggered = list.some((inp, i) => inp?.ability && isUp(state.players[i] ?? state.players[0]));
  if (triggered && state.zedCharge >= 1 && state.zedTime <= 0) {
    state.zedTime = ZED_DURATION;
    state.zedCharge = 0;
  } else if (state.zedTime <= 0 && state.zedCharge > 0 && state.zedCharge < 1) {
    state.zedCharge = Math.max(0, state.zedCharge - ZED_DRAIN_PER_SEC * dt);
  }
  // While active, the enemy-affecting updates below run on a slowed clock; the
  // per-player loop (movement/fire/dash/melee) always uses full `dt`.
  const zs = state.zedTime > 0 ? ZED_TIMESCALE : 1;

  updateCodTimers(state, dt); // Insta-Kill / Double Points / Fire Sale / notice timers
  updateDoors(state);
  const solids = mapSolids(state); // walls + still-closed doors
  const flow = getFlowField(state, solids); // multi-source: routes enemies to the nearest player

  const spd = speedMult(state);
  const regen = regenPerSec(state);
  const intermission = state.wave.phase === 'intermission';

  // Each standing player acts on their own input. Downed-but-alive players are
  // NOT up (isUp stays false everywhere — targeting, spawns, flashlight), but
  // they can still drag themselves toward safety at a crawl; the dead are inert.
  state.players.forEach((p, i) => {
    if (!isUp(p)) {
      if (p.alive && p.downed) updateCrawl(p, list[i] ?? emptyInput(), solids, dt);
      return;
    }
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
  placeDeployables(state, list); // A7: fold build actions into new barricades / traps
  updatePings(state, list, dt); // co-op pings: age out + fold this tick's ping actions in
  updateRevives(state, list, dt); // bleedout + teammate revives
  // A9: enemies + their projectiles + boss attack timers run at `dt * zs` (slowed
  // in Zed-Time); traps/barricades/waves stay on real dt (squad-side space control
  // and pacing shouldn't slow with the horde — see zs above; zs === 1 when off).
  updateEnemies(state.enemies, state.players, solids, dt * zs, flow, enemySpeedScale(state.wave.index));
  updateRangedEnemies(state, dt * zs); // spitters lob acid
  updateTraps(state, dt); // A7: electric-floor traps zap enemies in range (before combat clears the dead → trap kills pay out)
  updateBarricadeAttacks(state, dt); // A7: enemies chew barricades they're blocked by; destroyed ones are removed
  updateBosses(state, dt * zs, rng);
  updateBullets(state, dt, zs); // hostile projectiles slow; player bullets keep full dt
  updateCombat(state, dt, rng, zs); // enemy contact DPS slows; bullet hits/kills/cash stay full-rate
  updatePowerups(state, dt); // pick up dropped power-ups
  updateLoot(state, dt);
  updateDirector(state, dt); // AI Director: read stress → intensity (throttle + drop bias read below)
  updateWaves(state, dt, rng, flow); // flow gates spawns to reachable (opened) rooms; reads Director throttle
  updateExtraction(state, dt); // A8: extraction-mode escape objective / win condition
  updateDefend(state, DEFEND_WAVES); // A8: defend-mode generator win/lose check (no-op in other modes)

  if (state.players.every((p) => !p.alive)) state.gameOver = true; // whole squad down
}
