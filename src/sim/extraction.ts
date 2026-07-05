import { EXTRACT_HOLD, EXTRACT_OPEN_WAVE, EXTRACT_RADIUS, EXTRACTION_WAVE } from '../config';
import { isUp, type GameState } from './types';

/**
 * A8 — is the extraction exit currently open? It opens in `extraction` mode once
 * EXTRACT_OPEN_WAVE is reached, OR whenever the legacy EXTRACTION_WAVE is hit
 * (the `?ext` debug jump, which works in any mode). Endless/defend never open it.
 */
export function isExtractionOpen(state: GameState): boolean {
  const w = state.wave.index;
  return w >= EXTRACTION_WAVE || (state.mode === 'extraction' && w >= EXTRACT_OPEN_WAVE);
}

/**
 * The extraction-mode win condition (also the endless-game's legacy `?ext` exit).
 * Once the exit is open (see isExtractionOpen), an exit lights up. Any standing
 * player inside it fills the escape bar; leaving drains it. Hold it for
 * EXTRACT_HOLD seconds and the squad escapes — the run is won. The escape wave
 * never "clears" (see waves.ts), so the only way out is up.
 */
export function updateExtraction(state: GameState, dt: number): void {
  if (state.gameOver) return;
  if (!isExtractionOpen(state)) return;

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

/**
 * A8 — the defend-mode win/lose check. The generator's HP is chewed down in
 * updateCombat (any enemy overlapping it claws it at its contactDamage, exactly
 * like clawing a player); this only reads the result:
 *   • generator HP hits 0            → the run is lost (gameOver, won stays false)
 *   • cleared DEFEND_WAVES waves     → the squad wins ("DEFENDED!")
 * No-op in every other mode, so endless/extraction are untouched.
 */
export function updateDefend(state: GameState, defendWaves: number): void {
  if (state.mode !== 'defend' || state.gameOver) return;
  const gen = state.objective;
  if (!gen) return;
  if (gen.hp <= 0) {
    gen.hp = 0;
    state.gameOver = true; // generator lost — the objective failed (won stays false)
    return;
  }
  // wave.index is bumped PAST the last wave once it clears, so > DEFEND_WAVES means
  // every defended wave was survived with the generator still standing.
  if (state.wave.index > defendWaves) {
    state.won = true;
    state.gameOver = true;
  }
}
