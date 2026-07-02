# Slice 6 Spec — bosses (issue #7)

**GitHub issue:** #7
**Status:** In progress
**Depends on:** Slice 2 (zombies-waves)

## Problem Statement

Waves of fodder plateau. The brief wants "küçük boslar" — mini-bosses with
readable, telegraphed attack patterns that punctuate the run and force the player
to use dash and space rather than hold-to-win.

## Scope

- **Two bosses** (data-driven rows in `ZOMBIES`, `boss: true`):
  - **Bloater** — slow, huge HP, heavy contact. Attack: **spew** a radial ring of
    hostile projectiles.
  - **Screamer** — faster, ranged. Attacks: **spit** a projectile at the player;
    **summon** a few adds around itself.
- **Attack pattern system**: a boss counts down, **telegraphs** (a visible
  wind-up the player can dodge), then executes. Data: telegraph time, attack
  cooldown, per-boss attack list.
- **Hostile projectiles**: bullets gain a `hostile` flag; enemy projectiles
  damage the player (dash i-frames dodge them) and never hit enemies.
- **Boss waves**: a boss enters every `BOSS_WAVE_INTERVAL`th wave (alongside the
  normal budget), alternating the two bosses. The wave only clears once the boss
  (and everything else) is dead.
- **View**: bosses render larger (their radius), flash during telegraph, and show
  a boss health bar; hostile rounds are drawn distinctly.

## Non-Goals (this slice)

- No unique boss arenas, no phase transitions, no boss loot tables (bosses use the
  normal drop roll for now).
- No A* — bosses seek via the shared enemy movement.

## Success Criteria

- Both bosses telegraph then execute their attacks; hostile projectiles hurt the
  player and are dodgeable by dashing.
- Bosses appear on boss waves and gate wave completion.
- Sim stays Phaser-free; patterns/hostile bullets/boss waves are unit-tested;
  game boots (headless smoke test).
