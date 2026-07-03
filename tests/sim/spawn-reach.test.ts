import { describe, expect, it } from 'vitest';
import { getFlowField } from '../../src/sim/flowfield';
import { buildMap, mapSolids } from '../../src/sim/map';
import { createGameState } from '../../src/sim/state';
import { zoneValid } from '../../src/sim/waves';

function realMap() {
  const m = buildMap();
  const s = createGameState(m.walls, m.spawnZones, m.doors, m.playerStart, { width: m.width, height: m.height }, 1, m.extractionPoint, m.interactables);
  s.wave.index = 2; // wave 2: west-wing zones are "unlocked" by minWave but sealed by an unbought door
  return { m, s };
}

describe('spawns are gated to reachable (opened) rooms', () => {
  it('a zone behind an unopened pay-door is invalid until the door is bought', () => {
    const { m, s } = realMap();
    // a west-side zone whose only way in is the still-closed D1 pay-door
    const westZone = m.spawnZones.find((z) => z.x < 2000 && (z.minWave ?? 0) <= 2)!;
    expect(westZone).toBeTruthy();

    const sealedFlow = getFlowField(s, mapSolids(s));
    expect(zoneValid(s, westZone, sealedFlow)).toBe(false); // sealed → zombies would be trapped, so rejected

    // open the west pay-door (D1) — now the room is reachable
    const d1 = s.doors.find((d) => d.cost === 750 && d.x < 4000)!;
    d1.open = true;
    const openFlow = getFlowField(s, mapSolids(s));
    expect(zoneValid(s, westZone, openFlow)).toBe(true); // reachable → valid spawn again
  });

  it('a lobby zone the player can reach is always a valid spawn', () => {
    const { m, s } = realMap();
    const lobbyZone = m.spawnZones.find((z) => (z.minWave ?? 0) <= 1)!;
    s.players[0].aimAngle = Math.PI; // look away so the flashlight-cone check can't reject it
    const flow = getFlowField(s, mapSolids(s));
    expect(zoneValid(s, lobbyZone, flow)).toBe(true);
  });
});
