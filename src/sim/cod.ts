import {
  BOX_TEDDY_CHANCE,
  BOX_TEDDY_MIN_USES,
  CASH_PER_HIT,
  COST_MYSTERY_BOX,
  COST_MYSTERY_BOX_FIRESALE,
  COST_PACK_A_PUNCH,
  INTERACT_RADIUS,
  NOTICE_TIME,
  NUKE_CASH,
  PAP_DMG_MULT,
  POWERUP_EFFECT_TIME,
  POWERUP_MAX_ALIVE,
  POWERUP_TTL,
} from '../config';
import { WEAPONS } from './weapons';
import { isUp, type GameState, type Interactable, type PlayerInput, type PlayerState, type PowerUpKind, type WeaponId } from './types';
import type { Rng } from './waves';

/** Flash an announcer line (Samantha-style callouts). */
export function setNotice(state: GameState, text: string): void {
  state.notice = text;
  state.noticeT = NOTICE_TIME;
}

/** Double Points doubles every cash gain while active. */
export function cashMult(state: GameState): number {
  return state.doublePtsT > 0 ? 2 : 1;
}

/** Tick down all COD timers (power-up effects, notice, box-spin reveal). */
export function updateCodTimers(state: GameState, dt: number): void {
  state.instaKillT = Math.max(0, state.instaKillT - dt);
  state.doublePtsT = Math.max(0, state.doublePtsT - dt);
  state.fireSaleT = Math.max(0, state.fireSaleT - dt);
  state.noticeT = Math.max(0, state.noticeT - dt);
  if (state.noticeT === 0) state.notice = '';
  if (state.boxReveal) {
    state.boxReveal.t -= dt;
    if (state.boxReveal.t <= 0) state.boxReveal = null;
  }
}

// ── power-up drops ───────────────────────────────────────────────────────────
const POWERUP_TABLE: PowerUpKind[] = ['maxammo', 'maxammo', 'instakill', 'doublepoints', 'nuke', 'firesale'];

/** Maybe drop a power-up at a kill site (capped, COD-style). */
export function dropPowerUp(state: GameState, x: number, y: number, kind: PowerUpKind): void {
  if (state.powerups.length >= POWERUP_MAX_ALIVE) return;
  state.powerups.push({ id: state.nextPowerUpId++, kind, x, y, ttl: POWERUP_TTL });
}

export function rollPowerUp(rng: Rng): PowerUpKind {
  return POWERUP_TABLE[Math.floor(rng() * POWERUP_TABLE.length) % POWERUP_TABLE.length];
}

function refillAllAmmo(state: GameState): void {
  for (const p of state.players) {
    for (const id of p.owned) {
      const def = WEAPONS[id];
      if (def.startAmmo !== undefined) p.ammo[id] = def.startAmmo * (state.packed[id] ? 2 : 1);
    }
  }
}

/** Apply a picked-up power-up to the whole squad (COD is team-wide). */
export function applyPowerUp(state: GameState, kind: PowerUpKind): void {
  switch (kind) {
    case 'maxammo':
      refillAllAmmo(state);
      setNotice(state, 'MAX AMMO');
      break;
    case 'instakill':
      state.instaKillT = POWERUP_EFFECT_TIME;
      setNotice(state, 'INSTA-KILL');
      break;
    case 'doublepoints':
      state.doublePtsT = POWERUP_EFFECT_TIME;
      setNotice(state, 'DOUBLE POINTS');
      break;
    case 'firesale':
      state.fireSaleT = POWERUP_EFFECT_TIME;
      setNotice(state, 'FIRE SALE');
      break;
    case 'nuke':
      for (const e of state.enemies) if (!e.boss) e.hp = 0; // cleared next combat tick
      state.cash += NUKE_CASH * cashMult(state);
      setNotice(state, 'NUKE');
      break;
  }
}

/** Bleed power-up TTLs and let any standing player grab one by walking over it. */
export function updatePowerups(state: GameState, dt: number): void {
  const kept = [];
  for (const pu of state.powerups) {
    pu.ttl -= dt;
    if (pu.ttl <= 0) continue;
    const taker = state.players.find((p) => isUp(p) && (p.pos.x - pu.x) ** 2 + (p.pos.y - pu.y) ** 2 <= 40 * 40);
    if (!state.gameOver && taker) {
      applyPowerUp(state, pu.kind);
      continue;
    }
    kept.push(pu);
  }
  state.powerups = kept;
}

// ── interactables (doors handled in map.ts; box/PaP/wall/power here) ──────────
const BOX_POOL: { weapon: WeaponId; weight: number }[] = [
  { weapon: 'smg', weight: 5 },
  { weapon: 'shotgun', weight: 5 },
  { weapon: 'machinegun', weight: 4 },
  { weapon: 'minigun', weight: 2 },
  { weapon: 'rpg', weight: 2 },
  { weapon: 'chainsaw', weight: 2 },
  { weapon: 'raygun', weight: 1 }, // wonder weapon — the jackpot
];

function rollBoxWeapon(rng: Rng): WeaponId {
  const total = BOX_POOL.reduce((s, w) => s + w.weight, 0);
  let r = rng() * total;
  for (const opt of BOX_POOL) {
    r -= opt.weight;
    if (r <= 0) return opt.weapon;
  }
  return BOX_POOL[0].weapon;
}

function grantWeapon(state: GameState, p: PlayerState, id: WeaponId): void {
  const def = WEAPONS[id];
  if (!p.owned.includes(id)) p.owned.push(id);
  if (def.startAmmo !== undefined) p.ammo[id] = Math.max(p.ammo[id] ?? 0, def.startAmmo * (state.packed[id] ? 2 : 1));
  p.weapon = id;
}

function boxCost(state: GameState): number {
  return state.fireSaleT > 0 ? COST_MYSTERY_BOX_FIRESALE : COST_MYSTERY_BOX;
}

/** Cost shown for an interactable right now (box respects Fire Sale). */
export function interactCost(state: GameState, it: Interactable): number {
  if (it.kind === 'mysterybox') return boxCost(state);
  return it.cost;
}

/** True when this buyable is currently usable (power gate + affordability aside). */
export function interactReady(state: GameState, it: Interactable): boolean {
  if (it.needsPower && !state.powerOn) return false;
  if (it.kind === 'packapunch' && state.packed[state.players[0]?.weapon ?? 'pistol']) return false;
  return true;
}

function useInteractable(state: GameState, p: PlayerState, it: Interactable, rng: Rng): void {
  if (it.needsPower && !state.powerOn && it.kind !== 'power') return;
  const cost = interactCost(state, it);
  if (state.cash < cost) return;

  switch (it.kind) {
    case 'power':
      if (state.powerOn) return;
      state.powerOn = true;
      setNotice(state, 'POWER ON');
      break;
    case 'wallbuy': {
      const w = it.weapon!;
      if (!p.owned.includes(w)) grantWeapon(state, p, w);
      else if (WEAPONS[w].startAmmo !== undefined) p.ammo[w] = (p.ammo[w] ?? 0) + (WEAPONS[w].startAmmo ?? 0);
      else return; // already own an infinite-ammo wall gun
      break;
    }
    case 'mysterybox': {
      const weapon = rollBoxWeapon(rng);
      grantWeapon(state, p, weapon);
      state.boxReveal = { weapon, t: 1.4 };
      it.boxUses = (it.boxUses ?? 0) + 1;
      // teddy bear: after a few spins the box may pack up and relocate
      if (it.boxUses >= BOX_TEDDY_MIN_USES && it.homes && it.homes.length > 1 && rng() < BOX_TEDDY_CHANCE) {
        const others = it.homes.filter((h) => h.x !== it.x || h.y !== it.y);
        const dest = others[Math.floor(rng() * others.length) % others.length];
        it.x = dest.x;
        it.y = dest.y;
        it.boxUses = 0;
        state.boxReveal = null;
        setNotice(state, 'THE BOX HAS MOVED');
      }
      break;
    }
    case 'packapunch': {
      const w = p.weapon;
      if (state.packed[w]) return;
      state.packed[w] = true;
      if (WEAPONS[w].startAmmo !== undefined) p.ammo[w] = (p.ammo[w] ?? 0) * 2; // topped-up reserve
      setNotice(state, `${WEAPONS[w].name.toUpperCase()} UPGRADED`);
      break;
    }
  }
  state.cash -= cost;
}

/** Pay-to-open doors + fixed buyables, driven by each player's `use` edge. */
export function updateInteractions(state: GameState, inputs: PlayerInput[], rng: Rng): void {
  state.players.forEach((p, i) => {
    if (!isUp(p) || !inputs[i]?.use) return;
    const near = nearestBuyable(state, p);
    if (near) useInteractable(state, p, near, rng);
    else buyNearestDoor(state, p);
  });
}

/** The interactable within reach of this player, or null. */
export function nearestBuyable(state: GameState, p: PlayerState): Interactable | null {
  let best: Interactable | null = null;
  let bd = INTERACT_RADIUS * INTERACT_RADIUS;
  for (const it of state.interactables) {
    const d = (it.x - p.pos.x) ** 2 + (it.y - p.pos.y) ** 2;
    if (d < bd) {
      bd = d;
      best = it;
    }
  }
  return best;
}

/** Open the nearest still-closed pay-door if the player can afford it. */
function buyNearestDoor(state: GameState, p: PlayerState): void {
  for (const d of state.doors) {
    if (d.open || d.cost <= 0) continue;
    if (d.minWave > 0 && state.wave.index < d.minWave) continue;
    const cx = d.x + d.w / 2;
    const cy = d.y + d.h / 2;
    const reach = INTERACT_RADIUS + Math.max(d.w, d.h) / 2;
    if ((p.pos.x - cx) ** 2 + (p.pos.y - cy) ** 2 > reach * reach) continue;
    if (state.cash < d.cost) return;
    state.cash -= d.cost;
    d.open = true;
    return;
  }
}

/** Damage bonus from Pack-a-Punch for a given weapon. */
export function papDamageMult(state: GameState, weapon: WeaponId): number {
  return state.packed[weapon] ? PAP_DMG_MULT : 1;
}

export { CASH_PER_HIT };
