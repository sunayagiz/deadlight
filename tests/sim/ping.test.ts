import { describe, expect, it } from 'vitest';
import { PING_MAX_PER_PLAYER, PING_TTL, SIM_DT } from '../../src/config';
import { applySnapshot, snapshot } from '../../src/net/protocol';
import { spawnEnemy } from '../../src/sim/enemies';
import { createGameState, emptyInput } from '../../src/sim/state';
import { stepSim } from '../../src/sim/step';
import type { PlayerInput } from '../../src/sim/types';

/** Minimal host state; players spawn around (500,500). */
function mkState(numPlayers = 1) {
  const walls = [{ x: 0, y: 0, w: 10, h: 10 }];
  return createGameState(walls, [], [], { x: 500, y: 500 }, { width: 2000, height: 2000 }, numPlayers);
}

function pingInput(x: number, y: number): PlayerInput {
  const inp = emptyInput();
  inp.ping = { x, y };
  return inp;
}

describe('ping system (host-authoritative, via PlayerInput)', () => {
  it('adds a PingState at the aim point, auto-kind "enemy" when an enemy is near', () => {
    const s = mkState();
    spawnEnemy(s, 'shambler', { x: 700, y: 700 });
    stepSim(s, [pingInput(700, 700)], SIM_DT);
    expect(s.pings.length).toBe(1);
    expect(s.pings[0].kind).toBe('enemy');
    expect(s.pings[0].x).toBe(700);
    expect(s.pings[0].y).toBe(700);
    expect(s.pings[0].owner).toBe(0);
  });

  it('auto-kind "loot" when loot (and no enemy) is near the ping point', () => {
    const s = mkState();
    s.loot.push({ id: 1, pos: { x: 800, y: 800 }, kind: 'ammo', amount: 0, ttl: 20 });
    stepSim(s, [pingInput(800, 800)], SIM_DT);
    expect(s.pings.length).toBe(1);
    expect(s.pings[0].kind).toBe('loot');
  });

  it('auto-kind "go" when nothing is near the ping point', () => {
    const s = mkState();
    stepSim(s, [pingInput(1500, 1500)], SIM_DT);
    expect(s.pings.length).toBe(1);
    expect(s.pings[0].kind).toBe('go');
  });

  it('a ping expires after PING_TTL', () => {
    const s = mkState();
    stepSim(s, [pingInput(1500, 1500)], SIM_DT);
    expect(s.pings.length).toBe(1);
    const ticks = Math.ceil(PING_TTL / SIM_DT) + 2;
    for (let i = 0; i < ticks; i++) stepSim(s, [emptyInput()], SIM_DT);
    expect(s.pings.length).toBe(0);
  });

  it('enforces the per-player concurrent cap (oldest retired first)', () => {
    const s = mkState();
    const ids: number[] = [];
    for (let i = 0; i < PING_MAX_PER_PLAYER + 3; i++) {
      stepSim(s, [pingInput(1500 + i, 1500)], SIM_DT);
      ids.push(1500 + i);
    }
    const mine = s.pings.filter((p) => p.owner === 0);
    expect(mine.length).toBe(PING_MAX_PER_PLAYER);
    // the surviving pings are the most recent ones (oldest were dropped)
    const keptX = mine.map((p) => p.x).sort((a, b) => a - b);
    expect(keptX).toEqual(ids.slice(-PING_MAX_PER_PLAYER));
  });

  it('caps pings PER player, not globally (two players each keep their own)', () => {
    const s = mkState(2);
    for (let i = 0; i < PING_MAX_PER_PLAYER + 2; i++) {
      stepSim(s, [pingInput(1500 + i, 1500), pingInput(200 + i, 200)], SIM_DT);
    }
    expect(s.pings.filter((p) => p.owner === 0).length).toBe(PING_MAX_PER_PLAYER);
    expect(s.pings.filter((p) => p.owner === 1).length).toBe(PING_MAX_PER_PLAYER);
  });

  it('round-trips the pings snapshot field onto a guest (mirrors protocol.test)', () => {
    const host = mkState(2);
    host.pings.push({ id: 5, x: 123, y: 456, kind: 'enemy', owner: 1, ttl: 3 });
    host.pings.push({ id: 6, x: 789, y: 10, kind: 'go', owner: 0, ttl: 4.5 });
    host.nextPingId = 7;

    const guest = mkState(2);
    const wire = JSON.parse(JSON.stringify(snapshot(host))); // exactly what PeerJS sends
    applySnapshot(guest, wire);

    expect(guest.pings).toEqual(host.pings);
    expect(guest.nextPingId).toBe(7);
  });
});
