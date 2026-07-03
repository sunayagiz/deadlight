import { describe, it, expect } from 'vitest';
import { SIM_DT } from '../../src/config';
import { spawnEnemy } from '../../src/sim/enemies';
import { computeFlowField, sampleFlow } from '../../src/sim/flowfield';
import { buildMap, mapSolids } from '../../src/sim/map';
import { createGameState, emptyInput } from '../../src/sim/state';
import { stepSim } from '../../src/sim/step';
import type { Wall } from '../../src/sim/types';

describe('flow field', () => {
  it('points straight at the target in open space', () => {
    const f = computeFlowField(300, 300, [], [{ x: 250, y: 150 }]);
    const dir = sampleFlow(f, 50, 150)!;
    expect(dir.x).toBeGreaterThan(0.9); // basically due east
    expect(Math.abs(dir.y)).toBeLessThan(0.5);
  });

  it('routes around a wall through the opening (no wall-hugging)', () => {
    // wall splits the space vertically, opening at the bottom
    const wall: Wall = { x: 140, y: 0, w: 20, h: 220 }; // gap y 220..300
    const f = computeFlowField(300, 300, [wall], [{ x: 250, y: 60 }]);
    // an enemy west of the wall at the target's height must first head SOUTH toward the gap
    const dir = sampleFlow(f, 60, 60)!;
    expect(dir.y).toBeGreaterThan(0.3); // downward toward the opening, not straight east into the wall
  });

  it('returns null for positions sealed off from the target', () => {
    const box: Wall[] = [
      { x: 100, y: 100, w: 100, h: 10 },
      { x: 100, y: 190, w: 100, h: 10 },
      { x: 100, y: 100, w: 10, h: 100 },
      { x: 190, y: 100, w: 10, h: 100 },
    ];
    const f = computeFlowField(300, 300, box, [{ x: 50, y: 50 }]);
    expect(sampleFlow(f, 150, 150)).toBeNull(); // walled-in cell can't reach
  });

  it('in the real map, a zombie behind a wall makes progress toward the player', () => {
    const m = buildMap();
    const s = createGameState(m.walls, m.spawnZones, m.doors, m.playerStart, {
      width: m.width,
      height: m.height,
    });
    // zombie in the west wing; player in the lobby; rock between them.
    // open the D1 gate (west, the mw2 door left of the lobby) so a path exists.
    s.doors.find((d) => d.cost === 750 && d.x < 4000)!.open = true;
    const e = spawnEnemy(s, 'runner', { x: 1400, y: 1900 });
    const before = Math.hypot(s.player.pos.x - e.pos.x, s.player.pos.y - e.pos.y);
    for (let i = 0; i < 60 * 8; i++) stepSim(s, emptyInput(), SIM_DT, () => 0.99);
    const after = Math.hypot(s.player.pos.x - e.pos.x, s.player.pos.y - e.pos.y);
    expect(after).toBeLessThan(before - 200); // made real progress through the doorway
  });

  it('solids include closed doors: flow does not path through a shut gate', () => {
    const m = buildMap();
    const s = createGameState(m.walls, m.spawnZones, m.doors, m.playerStart, {
      width: m.width,
      height: m.height,
    });
    const f = computeFlowField(s.mapW, s.mapH, mapSolids(s), [s.player.pos]);
    // the closed D1 gate bar itself is solid, so its cell has no flow direction
    const d1 = s.doors.find((d) => d.cost === 750 && d.x < 4000)!;
    expect(sampleFlow(f, d1.x + d1.w / 2, d1.y + d1.h / 2)).toBeNull();
  });
});
