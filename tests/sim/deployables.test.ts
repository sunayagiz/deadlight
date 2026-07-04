import { describe, expect, it } from 'vitest';
import {
  BARRICADE_HP,
  BARRICADE_SIZE,
  COST_BARRICADE,
  COST_TRAP,
  MAX_BARRICADES,
  TRAP_DAMAGE,
  TRAP_RADIUS,
} from '../../src/config';
import { placeDeployables, updateBarricadeAttacks, updateTraps } from '../../src/sim/deployables';
import { spawnEnemy } from '../../src/sim/enemies';
import { computeFlowField, sampleFlow } from '../../src/sim/flowfield';
import { mapSolids } from '../../src/sim/map';
import { snapshot, applySnapshot } from '../../src/net/protocol';
import { createGameState, emptyInput } from '../../src/sim/state';
import type { DeployableKind, GameState, Wall } from '../../src/sim/types';

// player starts at (100,100) on a big open floor
function fresh(walls: Wall[] = []): GameState {
  return createGameState(walls, [{ x: 0, y: 0 }], [], { x: 100, y: 100 }, { width: 3000, height: 3000 }, 1);
}
const place = (x: number, y: number, kind: DeployableKind) => [{ ...emptyInput(), place: { x, y, kind } }];

describe('A7 barricades', () => {
  it('placing a barricade via PlayerInput deducts cash and adds a solid so mapSolids grows', () => {
    const s = fresh();
    s.cash = 1000;
    const before = mapSolids(s).length;
    placeDeployables(s, place(160, 100, 'barricade'));
    expect(s.deployables.length).toBe(1);
    expect(s.deployables[0].hp).toBe(BARRICADE_HP);
    expect(s.cash).toBe(1000 - COST_BARRICADE);
    expect(mapSolids(s).length).toBe(before + 1); // the barricade is now a solid AABB
  });

  it('the flow field routes around a placed barricade (its cell becomes no-flow)', () => {
    const s = fresh();
    s.cash = 1000;
    // before: the barricade spot has flow toward the player at (100,100)
    const cx = 300;
    const cy = 300;
    const pre = computeFlowField(s.mapW, s.mapH, mapSolids(s), [s.players[0].pos]);
    expect(sampleFlow(pre, cx, cy)).not.toBeNull();
    // place a barricade right on that cell; place range is generous, so move player near it first
    s.players[0].pos = { x: cx, y: cy + 120 };
    placeDeployables(s, place(cx, cy, 'barricade'));
    expect(s.deployables.length).toBe(1);
    const post = computeFlowField(s.mapW, s.mapH, mapSolids(s), [s.players[0].pos]);
    expect(sampleFlow(post, cx, cy)).toBeNull(); // blocked → the horde must route around it
  });

  it('an enemy adjacent to a barricade reduces its hp and it is removed at 0', () => {
    const s = fresh();
    s.cash = 1000;
    placeDeployables(s, place(160, 100, 'barricade'));
    const bar = s.deployables[0];
    // shambler just up against the barricade's left edge
    spawnEnemy(s, 'shambler', { x: 120, y: 100 });
    updateBarricadeAttacks(s, 1 / 60);
    expect(bar.hp!).toBeLessThan(BARRICADE_HP); // chewed
    expect(bar.hp!).toBeGreaterThan(0);
    // one more tick after draining it removes the barricade (and it stops being solid)
    bar.hp = 0.001;
    const solidsBefore = mapSolids(s).length;
    updateBarricadeAttacks(s, 1 / 60);
    expect(s.deployables.length).toBe(0);
    expect(mapSolids(s).length).toBe(solidsBefore - 1);
  });
});

describe('A7 traps', () => {
  it('a trap zaps an enemy inside its radius but not one outside', () => {
    const s = fresh();
    s.cash = 2000;
    placeDeployables(s, place(160, 100, 'trap'));
    expect(s.deployables[0].kind).toBe('trap');
    const inRange = spawnEnemy(s, 'brute', { x: 160, y: 100 + TRAP_RADIUS - 20 });
    const outRange = spawnEnemy(s, 'brute', { x: 160, y: 100 + TRAP_RADIUS + 200 });
    const inHp = inRange.hp;
    const outHp = outRange.hp;
    updateTraps(s, 1 / 60);
    expect(inRange.hp).toBe(inHp - TRAP_DAMAGE);
    expect(outRange.hp).toBe(outHp); // untouched
  });

  it('a trap goes on cooldown after firing (no zap while recharging)', () => {
    const s = fresh();
    s.cash = 2000;
    placeDeployables(s, place(160, 100, 'trap'));
    const e = spawnEnemy(s, 'brute', { x: 160, y: 100 });
    updateTraps(s, 1 / 60);
    const afterFirst = e.hp;
    expect(s.deployables[0].cd!).toBeGreaterThan(0);
    updateTraps(s, 1 / 60); // still recharging → no further damage
    expect(e.hp).toBe(afterFirst);
  });
});

describe('A7 placement validation', () => {
  it('rejects a barricade inside a wall', () => {
    const wall: Wall = { x: 140, y: 80, w: 60, h: 60 };
    const s = fresh([wall]);
    s.cash = 1000;
    placeDeployables(s, place(170, 110, 'barricade')); // dead centre of the wall
    expect(s.deployables.length).toBe(0);
    expect(s.cash).toBe(1000); // no charge on a rejected placement
  });

  it('rejects a placement the squad cannot afford', () => {
    const s = fresh();
    s.cash = COST_BARRICADE - 1;
    placeDeployables(s, place(160, 100, 'barricade'));
    expect(s.deployables.length).toBe(0);
    expect(s.cash).toBe(COST_BARRICADE - 1);
  });

  it('rejects a placement too far from the player', () => {
    const s = fresh();
    s.cash = 1000;
    placeDeployables(s, place(1500, 1500, 'barricade')); // way across the map
    expect(s.deployables.length).toBe(0);
    expect(s.cash).toBe(1000);
  });

  it('enforces the per-squad max count', () => {
    const s = fresh();
    s.cash = 999999;
    for (let i = 0; i < MAX_BARRICADES; i++) {
      s.deployables.push({ id: s.nextDeployableId++, kind: 'barricade', x: 2000 + i * 80, y: 2000, hp: BARRICADE_HP, owner: 0 });
    }
    const cashBefore = s.cash;
    placeDeployables(s, place(160, 100, 'barricade')); // valid spot, but at the cap
    expect(s.deployables.length).toBe(MAX_BARRICADES); // not MAX+1
    expect(s.cash).toBe(cashBefore);
  });
});

describe('A7 serialization', () => {
  it('round-trips deployables + nextDeployableId through the snapshot', () => {
    const s = fresh();
    s.cash = 3000;
    placeDeployables(s, place(160, 100, 'barricade'));
    placeDeployables(s, place(100, 160, 'trap'));
    expect(s.deployables.length).toBe(2);
    const snap = snapshot(s);
    const guest = fresh();
    applySnapshot(guest, snap);
    expect(guest.deployables.length).toBe(2);
    expect(guest.nextDeployableId).toBe(s.nextDeployableId);
    expect(guest.deployables[0].kind).toBe('barricade');
    expect(guest.deployables[0].hp).toBe(BARRICADE_HP);
    expect(guest.deployables[1].kind).toBe('trap');
    expect(BARRICADE_SIZE).toBeGreaterThan(0); // (sanity: config exported)
    expect(COST_TRAP).toBeGreaterThan(0);
  });
});
