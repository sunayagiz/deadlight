import { EXTRACT_HOLD, EXTRACT_RADIUS, EXTRACTION_WAVE } from '../config';
import { isUp, type GameState } from './types';

/**
 * The run's win condition. Once the final wave (EXTRACTION_WAVE) begins, an exit
 * lights up. Any standing player inside it fills the escape bar; leaving drains
 * it. Hold it for EXTRACT_HOLD seconds and the squad escapes — the run is won.
 * The final wave itself never "clears" (see waves.ts), so the only way out is up.
 */
export function updateExtraction(state: GameState, dt: number): void {
  if (state.gameOver) return;
  if (state.wave.index < EXTRACTION_WAVE) return;

  if (!state.extraction) {
    state.extraction = { x: state.extractPoint.x, y: state.extractPoint.y, progress: 0 };
  }
  const ex = state.extraction;
  const r2 = EXTRACT_RADIUS * EXTRACT_RADIUS;
  const holding = state.players.some(
    (p) => isUp(p) && (p.pos.x - ex.x) ** 2 + (p.pos.y - ex.y) ** 2 <= r2,
  );

  ex.progress = holding
    ? Math.min(EXTRACT_HOLD, ex.progress + dt)
    : Math.max(0, ex.progress - dt * 0.6); // bleeds back out, but slower than it fills

  if (ex.progress >= EXTRACT_HOLD) {
    state.won = true;
    state.gameOver = true;
  }
}
