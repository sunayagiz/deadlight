import { describe, it, expect } from 'vitest';
import { PLAYER_RADIUS, SIM_DT } from '../../src/config';
import { buildMap, mapSolids, updateDoors } from '../../src/sim/map';
import { updateMovement } from '../../src/sim/movement';
import { createGameState, createPlayer, emptyInput } from '../../src/sim/state';
import { segmentClear } from '../../src/sim/vision';

function bigMapState() {
  const m = buildMap();
  return createGameState(m.walls, m.spawnZones, m.doors, m.playerStart, {
    width: m.width,
    height: m.height,
  });
}

describe('map + doors', () => {
  it('buildMap: 6x4-screen complex with gated progression', () => {
    const m = buildMap();
    expect(m.width).toBe(5760);
    expect(m.height).toBe(2160);
    expect(m.walls.length).toBeGreaterThan(20);
    expect(m.doors.length).toBeGreaterThanOrEqual(10);
    expect(m.doors.every((d) => !d.open)).toBe(true); // all start closed
    expect(m.doors.some((d) => d.minWave >= 2)).toBe(true); // gates exist
    expect(m.spawnZones.some((z) => (z.minWave ?? 0) <= 1)).toBe(true); // wave-1 pressure exists
    expect(m.spawnZones.length).toBeGreaterThanOrEqual(15);
  });

  it('mapSolids counts closed doors as solid and drops open ones', () => {
    const s = bigMapState();
    const withClosed = mapSolids(s).length;
    s.doors[0].open = true;
    const withOneOpen = mapSolids(s).length;
    expect(withOneOpen).toBe(withClosed - 1);
  });

  it('an interior door opens on proximity; far doors stay shut', () => {
    const s = bigMapState();
    const d = s.doors.find((x) => x.minWave === 0)!;
    updateDoors(s); // player at lobby start, far from it
    expect(d.open).toBe(false);
    s.player.pos = { x: d.x + d.w / 2, y: d.y + d.h / 2 - 30 };
    updateDoors(s);
    expect(d.open).toBe(true);
  });

  it('a gate door stays locked before its wave and opens after', () => {
    const s = bigMapState();
    const gate = s.doors.find((x) => x.minWave === 2)!;
    s.player.pos = { x: gate.x + gate.w / 2 + 30, y: gate.y + gate.h / 2 };
    s.wave.index = 1;
    updateDoors(s);
    expect(gate.open).toBe(false); // locked: too early
    s.wave.index = 2;
    updateDoors(s);
    expect(gate.open).toBe(true); // unlocked at its milestone
  });

  it('a closed door blocks movement like a wall', () => {
    const door = { x: 300, y: 0, w: 20, h: 200 };
    const p = createPlayer(300 - PLAYER_RADIUS - 1, 100);
    updateMovement(p, { ...emptyInput(), moveX: 1 }, [door], SIM_DT);
    expect(p.pos.x).toBeCloseTo(300 - PLAYER_RADIUS); // stopped at the door face
  });
});

describe('line of sight', () => {
  it('is clear with nothing in the way', () => {
    expect(segmentClear({ x: 0, y: 0 }, { x: 100, y: 0 }, [])).toBe(true);
  });

  it('is blocked by a wall between the points', () => {
    const wall = { x: 50, y: -20, w: 10, h: 40 };
    expect(segmentClear({ x: 0, y: 0 }, { x: 100, y: 0 }, [wall])).toBe(false);
  });

  it('is not blocked by a wall off to the side', () => {
    const wall = { x: 50, y: 100, w: 10, h: 40 };
    expect(segmentClear({ x: 0, y: 0 }, { x: 100, y: 0 }, [wall])).toBe(true);
  });

  it('the lobby cannot see into the sealed grand hall', () => {
    const s = bigMapState();
    // from lobby start straight north to hall center: blocked by the divider + closed D6
    expect(segmentClear(s.player.pos, { x: 2850, y: 350 }, mapSolids(s))).toBe(false);
  });
});
