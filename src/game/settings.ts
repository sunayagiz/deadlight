/**
 * Accessibility settings — persisted in localStorage under a versioned key.
 * Render/UI-layer ONLY: this lives OUTSIDE GameState/sim (the deterministic sim
 * never touches storage or the clock) and is NEVER part of the netcoded Snapshot.
 * GameScene and the lobby read it to scale screen-shake / damage-flash, remap the
 * palette for colour-blind players, surface captions for audio cues, and boost
 * contrast — all purely on the render side, so co-op determinism is untouched.
 *
 * Mirrors scores.ts / profile.ts: guarded load/save that degrades to sensible
 * defaults if storage is disabled (private mode / bad JSON) so the game never
 * crashes on it.
 */

import type { AffixId } from '../sim/types';

const KEY = 'deadlight.settings.v1';

export type ColorblindMode = 'off' | 'deuter' | 'prot' | 'trit';

export interface Settings {
  /** Colour-blind palette remap for power-ups + affix auras ('off' = default hues). */
  colorblind: ColorblindMode;
  /** Show brief on-screen captions for key non-speech audio cues. */
  captions: boolean;
  /** Camera-shake multiplier, 0..1 (0 = no shake — motion-sensitivity friendly). */
  shake: number;
  /** Damage-flash / full-screen-flash alpha multiplier, 0..1 (0 = no red flash — photosensitivity). */
  flash: number;
  /** Brighten enemy outlines + HUD for low-vision / high-glare play. */
  highContrast: boolean;
}

/** Colour-blind mode cycle order (used by the lobby's cycle button). */
export const COLORBLIND_MODES: ColorblindMode[] = ['off', 'deuter', 'prot', 'trit'];

/** Short human labels for the cycle button. */
export const COLORBLIND_LABEL: Record<ColorblindMode, string> = {
  off: 'OFF',
  deuter: 'DEUTERANOPIA',
  prot: 'PROTANOPIA',
  trit: 'TRITANOPIA',
};

/** Defaults preserve the current look/feel: everything on, full intensity. */
function fresh(): Settings {
  return { colorblind: 'off', captions: true, shake: 1, flash: 1, highContrast: false };
}

/** Clamp any input to 0..1 (bad/NaN → 0). Pure — exported for unit tests + reuse. */
export function clamp01(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const p = JSON.parse(raw) as Partial<Settings>;
    const d = fresh();
    return {
      colorblind: COLORBLIND_MODES.includes(p.colorblind as ColorblindMode) ? (p.colorblind as ColorblindMode) : d.colorblind,
      captions: typeof p.captions === 'boolean' ? p.captions : d.captions,
      shake: p.shake === undefined ? d.shake : clamp01(p.shake),
      flash: p.flash === undefined ? d.flash : clamp01(p.flash),
      highContrast: typeof p.highContrast === 'boolean' ? p.highContrast : d.highContrast,
    };
  } catch {
    return fresh(); // storage disabled / private mode / bad JSON → defaults
  }
}

function save(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore: nothing we can do if storage is unavailable */
  }
}

/** The full current settings (always well-formed; defaults preserve the vanilla look). */
export function getSettings(): Settings {
  return load();
}

/** Merge `patch` into the stored settings, persist, and return the new value. */
export function setSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...load(), ...patch };
  // re-normalise the merged result so out-of-range values never persist
  const clean: Settings = {
    colorblind: COLORBLIND_MODES.includes(next.colorblind) ? next.colorblind : 'off',
    captions: !!next.captions,
    shake: clamp01(next.shake),
    flash: clamp01(next.flash),
    highContrast: !!next.highContrast,
  };
  save(clean);
  return clean;
}

/** Advance the colour-blind mode to the next in the cycle, persist, and return it. */
export function cycleColorblind(): ColorblindMode {
  const cur = load().colorblind;
  const next = COLORBLIND_MODES[(COLORBLIND_MODES.indexOf(cur) + 1) % COLORBLIND_MODES.length];
  setSettings({ colorblind: next });
  return next;
}

// ── Render-side scaling helpers (pure) ───────────────────────────────────────

/** Camera-shake intensity after the accessibility multiplier (0 = no shake). */
export function scaledShake(baseIntensity: number, s: Settings): number {
  return baseIntensity * clamp01(s.shake);
}

/** Full-screen flash/vignette alpha after the accessibility multiplier (0 = none). */
export function scaledFlash(baseAlpha: number, s: Settings): number {
  return baseAlpha * clamp01(s.flash);
}

// ── Colour-blind-safe palette (Okabe–Ito) ────────────────────────────────────
// One qualitative palette engineered to stay distinguishable under deuteranopia,
// protanopia AND tritanopia, so any active mode maps to it. Colour is never the
// only channel: power-ups keep their letter labels (MAX/INSTA/…) and affixes get
// a letter tag (see AFFIX_TAG in GameScene), so hue is only a secondary cue.

/** Okabe–Ito safe hues (0xRRGGBB). */
export const CB_SAFE = {
  skyblue: 0x56b4e9,
  orange: 0xe69f00,
  green: 0x009e73,
  yellow: 0xf0e442,
  vermillion: 0xd55e00,
  purple: 0xcc79a7,
} as const;

/** Colour-blind remap for each affix aura/tint (chosen for max mutual separation). */
const CB_AFFIX: Record<AffixId, number> = {
  swift: CB_SAFE.yellow,
  tank: CB_SAFE.skyblue,
  shielded: CB_SAFE.purple,
  volatile: CB_SAFE.vermillion,
  vampiric: CB_SAFE.green,
};

/** Colour-blind remap for each power-up icon colour. */
const CB_POWERUP: Record<string, number> = {
  maxammo: CB_SAFE.skyblue,
  instakill: CB_SAFE.vermillion,
  nuke: CB_SAFE.orange,
  doublepoints: CB_SAFE.yellow,
  firesale: CB_SAFE.green,
};

/** Affix tint honouring the colour-blind setting (`base` used when mode is 'off'). */
export function affixTint(affix: AffixId, base: number, mode: ColorblindMode): number {
  return mode === 'off' ? base : (CB_AFFIX[affix] ?? base);
}

/** Power-up colour honouring the colour-blind setting (`base` used when mode is 'off'). */
export function powerupColor(kind: string, base: number, mode: ColorblindMode): number {
  return mode === 'off' ? base : (CB_POWERUP[kind] ?? base);
}
