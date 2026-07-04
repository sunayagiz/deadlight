/**
 * B5 — Dynamic music mix (pure helpers).
 *
 * Render/audio-layer ONLY: each client derives its own soundtrack mix locally
 * from the already-serialized AI-Director `intensity` (0..1) plus sim state.
 * Nothing here touches GameState or the netcoded Snapshot, so co-op needs no
 * netcode change — every client computes the same mix from the same intensity.
 *
 * A quiet calm bed always loops; a second `music_tension` layer fades UP as the
 * Director's stress rises (L4D-style mood), and the base bed swells slightly at
 * the top end. Kept as pure, unit-testable curves so the mapping is verifiable
 * without a Phaser/audio device.
 */

/** Clamp to 0..1 (bad/NaN → 0). */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Max volume the tension layer reaches at peak intensity (ear-safe cap). */
export const TENSION_MAX = 0.5;
/** Base (calm) bed volume — matches the pre-B5 constant loop level. */
export const BED_BASE = 0.35;
/** Extra bed swell added on top of BED_BASE at high intensity. */
export const BED_SWELL = 0.1;

/**
 * Target volume for the `music_tension` layer given Director intensity (0..1).
 * Silent through the calm floor (bed carries it), then ramps linearly up to
 * TENSION_MAX by the Director's peak. Pure — unit-tested.
 */
export function tensionVolume(intensity: number): number {
  const i = clamp01(intensity);
  const lo = 0.1; // below this the tension layer stays silent
  const hi = 0.85; // Director peak — tension fully faded in here
  const t = clamp01((i - lo) / (hi - lo));
  return t * TENSION_MAX;
}

/**
 * Target volume for the base calm bed given intensity: sits at BED_BASE through
 * the low/mid range, swells by up to BED_SWELL as intensity climbs past the mid
 * point so the top of a horde feels a touch fuller. Pure — unit-tested.
 */
export function bedVolume(intensity: number): number {
  const i = clamp01(intensity);
  const swell = clamp01((i - 0.5) / 0.35) * BED_SWELL;
  return BED_BASE + swell;
}

/**
 * Frame-rate-independent exponential lerp toward a target (no abrupt jumps).
 * `tau` is the ~time constant in seconds. Pure — reused for both layers.
 */
export function lerpTo(current: number, target: number, dt: number, tau: number): number {
  const k = 1 - Math.exp(-dt / tau);
  return current + (target - current) * k;
}
