import { describe, expect, it } from 'vitest';
import { SIM_DT, EXTRACTION_WAVE } from '../../src/config';
import { applySnapshot, snapshot } from '../../src/net/protocol';
import { spawnEnemy } from '../../src/sim/enemies';
import { createGameState, emptyInput } from '../../src/sim/state';
import { stepSim } from '../../src/sim/step';

function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

/** A host state driven a few ticks so it carries real dynamic content. */
function hostState() {
  const walls = [{ x: 0, y: 0, w: 10, h: 2000 }];
  const zones = [{ x: 400, y: 400 }];
  const s = createGameState(walls, zones, [{ x: 300, y: 300, w: 24, h: 100, open: false, minWave: 0, cost: 0 }], { x: 500, y: 500 }, { width: 2000, height: 2000 }, 2);
  const rng = seq([0.1, 0.5, 0.9]);
  spawnEnemy(s, 'runner', { x: 450, y: 450 });
  const inputs = [emptyInput(), emptyInput()];
  for (let i = 0; i < 30; i++) stepSim(s, inputs, SIM_DT, rng);
  return s;
}

describe('snapshot round-trip', () => {
  it('carries every new field (cash/won/perks/draft/extraction) onto the guest', () => {
    const host = hostState();
    host.cash = 275;
    host.perks = { damage: 2, greed: 1 };
    host.perkDraft = ['speed', 'vigor', 'regen'];
    host.rerollCount = 2;
    host.banished = ['thorns', 'lifesteal'];
    host.won = false;

    // fresh guest with the same static map, empty dynamic state
    const guest = createGameState(host.walls, host.spawnZones, host.doors, { x: 500, y: 500 }, { width: 2000, height: 2000 }, 2);
    applySnapshot(guest, snapshot(host));

    expect(guest.cash).toBe(275);
    expect(guest.perks).toEqual({ damage: 2, greed: 1 });
    expect(guest.perkDraft).toEqual(['speed', 'vigor', 'regen']);
    expect(guest.rerollCount).toBe(2);
    expect(guest.banished).toEqual(['thorns', 'lifesteal']);
    expect(guest.won).toBe(false);
    expect(guest.players.length).toBe(host.players.length);
    expect(guest.players[0].pos).toEqual(host.players[0].pos);
    expect(guest.enemies.length).toBe(host.enemies.length);
    expect(guest.enemies[0]?.pos).toEqual(host.enemies[0]?.pos);
    expect(guest.wave.index).toBe(host.wave.index);
    expect(guest.player).toBe(guest.players[0]); // alias kept live
  });

  it('syncs the extraction objective and win flag to the guest', () => {
    const host = hostState();
    host.wave.index = EXTRACTION_WAVE;
    host.extraction = { x: 1800, y: 1800, progress: 7.5 };
    host.won = true;
    host.gameOver = true;

    const guest = createGameState(host.walls, host.spawnZones, host.doors, { x: 500, y: 500 }, { width: 2000, height: 2000 }, 2);
    applySnapshot(guest, snapshot(host));

    expect(guest.extraction).toEqual({ x: 1800, y: 1800, progress: 7.5 });
    expect(guest.won).toBe(true);
    expect(guest.gameOver).toBe(true);
  });

  it('round-trips through JSON (the wire uses json serialization)', () => {
    const host = hostState();
    host.cash = 99;
    const wire = JSON.parse(JSON.stringify(snapshot(host))); // exactly what PeerJS sends
    const guest = createGameState(host.walls, host.spawnZones, host.doors, { x: 500, y: 500 }, { width: 2000, height: 2000 }, 2);
    applySnapshot(guest, wire);
    expect(guest.cash).toBe(99);
    expect(guest.enemies.length).toBe(host.enemies.length);
  });
});
