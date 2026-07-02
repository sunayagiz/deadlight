# Slice 5 Spec — arsenal-loot

**GitHub issue:** #6
**Status:** In progress
**Depends on:** Slice 1 (core-feel), Slice 2 (zombies-waves)

> Built ahead of slices 3–4 because the arsenal is pure sim (no map/netcode
> dependency) and is the feature the brief cares most about. Ordering note kept
> here so the plan history is honest.

## Problem Statement

Slice 1 shipped one gun. The brief wants a whole arsenal that *feels* distinct —
pistol, SMG, shotgun, machine gun, minigun (special), RPG, plus melee: katana,
baseball bat, chainsaw. And a reason to keep playing: enemies drop loot you pick
up to grow that arsenal mid-run.

## Scope

- **Weapon table v2** (still data-driven, `kind` selects behaviour):
  - `gun`: pistol/smg/shotgun/machinegun/minigun — params for damage, fire rate,
    bullet speed/ttl, **pellets** (shotgun), **spread**, and minigun **spin-up**
    that ramps fire rate while held.
  - `rpg`: projectile that **explodes** on impact — splash damage to enemies in
    radius and to the player if caught in the blast (self-harm risk).
  - `melee`: katana/bat **swing** an arc once per cooldown; chainsaw is **held**
    continuous dps that burns fuel.
- **Ammo**: minigun/rpg/chainsaw are limited; the rest are infinite.
- **Weapon switching**: number keys equip by slot, Q/E and mouse wheel cycle the
  owned set.
- **Loot**: killed enemies roll a loot table (weapons + ammo); drops despawn on a
  ttl and are collected on walkover — new weapons auto-equip, duplicates/ammo
  top up the reserve.

## Non-Goals (this slice)

- No economy/shop, no weapon rarity tiers, no reload animation.
- No map/vision (slice 3) or netcode (slice 4) coupling.

## Success Criteria

- Every weapon behaves distinctly and is unit-tested (spread, spin-up, splash,
  melee arc, ammo gating).
- Loot drops, despawns and is picked up correctly; switching works.
- `src/sim` stays Phaser-free; game boots and renders the arsenal + loot + a
  weapon HUD (headless boot smoke test).
