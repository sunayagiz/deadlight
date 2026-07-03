#!/usr/bin/env python3
"""Deadlight character art — volumetric top-down sprites built from shaded
anatomy (head/torso/arms/legs/hands), not flat blobs. Facing +x (east)."""
import math, random, sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops

SS = 4          # supersample
C = 128         # final canvas px
S = C * SS      # working canvas
random.seed(7)

def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))

def new():
    return Image.new("RGBA", (S, S), (0, 0, 0, 0))

def sphere(px, cx, cy, r, base, light=(-0.55, -0.62), hi=0.5, lo=0.60):
    """Volumetric ball: dark rim -> offset bright highlight."""
    cx, cy, r = cx * SS, cy * SS, r * SS
    dark = lerp(base, (0, 0, 0), lo)
    lite = lerp(base, (255, 255, 255), hi)
    steps = max(4, int(r / 1.4))
    for i in range(steps, 0, -1):
        t = i / steps                      # 1 outer .. 0 inner
        col = lerp(lite, dark, t ** 0.85)
        rr = r * t
        ox = cx + light[0] * (r - rr) * 0.85
        oy = cy + light[1] * (r - rr) * 0.85
        px.ellipse([ox - rr, oy - rr, ox + rr, oy + rr], fill=col + (255,))

def capsule(px, p0, p1, r0, r1, base, light=(-0.55, -0.62), hi=0.5, lo=0.6):
    d = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    n = max(2, int(d * SS / 2.2))
    for i in range(n + 1):
        t = i / n
        cx = p0[0] + (p1[0] - p0[0]) * t
        cy = p0[1] + (p1[1] - p0[1]) * t
        rr = r0 + (r1 - r0) * t
        sphere(px, cx, cy, rr, base, light, hi, lo)

def claw(px, base, wristx, wristy, ang, length=9, spread=0.5):
    """A grasping hand: palm + 3 tapered fingers."""
    sphere(px, wristx, wristy, 3.4, base, hi=0.4, lo=0.55)
    for k in (-1, 0, 1):
        a = ang + k * spread
        fx = wristx + math.cos(a) * length
        fy = wristy + math.sin(a) * length
        capsule(px, (wristx, wristy), (fx, fy), 1.7, 0.7, base, hi=0.45, lo=0.5)
        # dark claw tip
        px.ellipse([(fx - 1.2) * SS, (fy - 1.2) * SS, (fx + 1.2) * SS, (fy + 1.2) * SS],
                   fill=(24, 18, 16, 255))

def mottle(layer, mask, base, n=140, spread=26):
    """Rotting-skin blotches confined to the silhouette."""
    d = ImageDraw.Draw(layer)
    bbox = mask.getbbox()
    if not bbox:
        return
    for _ in range(n):
        x = random.randint(bbox[0], bbox[2]); y = random.randint(bbox[1], bbox[3])
        if mask.getpixel((x, y)) < 40:
            continue
        r = random.randint(3, 9) * SS // 3
        if random.random() < 0.5:
            col = lerp(base, (0, 0, 0), random.uniform(0.2, 0.5))
        else:
            col = lerp(base, (200, 210, 150), random.uniform(0.15, 0.4))
        a = random.randint(30, 80)
        d.ellipse([x - r, y - r, x + r, y + r], fill=col + (a,))

def blood(layer, mask, pts, big=False):
    d = ImageDraw.Draw(layer)
    for (x, y) in pts:
        for _ in range(6 if big else 3):
            r = random.randint(2, 6 if big else 4) * SS // 2
            ox = x * SS + random.randint(-8, 8) * SS // 3
            oy = y * SS + random.randint(-8, 8) * SS // 3
            if mask.getpixel((min(S-1,max(0,ox)), min(S-1,max(0,oy)))) < 30:
                continue
            shade = random.choice([(120, 16, 18), (90, 8, 10), (150, 30, 26)])
            d.ellipse([ox - r, oy - r, ox + r, oy + r], fill=shade + (random.randint(120, 200),))

def finish(layer, name, outdir):
    """Dark outline for readability on the dark map, then downscale w/ AA."""
    alpha = layer.split()[3]
    # outline: dilate alpha, subtract, paint near-black under the art
    dil = alpha.filter(ImageFilter.MaxFilter(2 * SS + 1))
    edge = ImageChops.subtract(dil, alpha)
    outline = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    outline.paste((8, 7, 9, 255), (0, 0), edge)
    out = Image.alpha_composite(outline, layer)
    out = out.filter(ImageFilter.GaussianBlur(SS * 0.35))
    out = out.resize((C, C), Image.LANCZOS)
    out.save(f"{outdir}/{name}.png")

def silhouette_mask(layer):
    return layer.split()[3].point(lambda a: 255 if a > 30 else 0)

# ── palettes ────────────────────────────────────────────────────────────────
ROT   = (104, 122, 86)
PALE  = (150, 148, 134)
MUSCLE= (150, 74, 66)
BLOAT = (150, 170, 96)
SHIRT = (66, 70, 78)
JACKET= (46, 52, 62)
PSKIN = (176, 140, 112)

def build_zombie(kind, outdir):
    L = new(); px = ImageDraw.Draw(L)
    if kind == "shambler":
        skin, shirt = ROT, SHIRT
        # legs (behind), torso, reaching arms, lolling head
        capsule(px, (40, 54), (58, 58), 5, 6.5, lerp(shirt,(0,0,0),0.2))
        capsule(px, (40, 74), (58, 70), 5, 6.5, lerp(shirt,(0,0,0),0.2))
        capsule(px, (58, 46), (58, 82), 15, 15, shirt)      # torso/shirt
        # torn shirt gaps show skin
        sphere(px, 60, 64, 9, skin, hi=0.35, lo=0.5)
        capsule(px, (60, 50), (96, 54), 6.5, 3.4, skin)     # arm up
        capsule(px, (60, 78), (92, 76), 6.5, 3.4, skin)     # arm out
        claw(px, skin, 96, 54, -0.15); claw(px, skin, 92, 76, 0.1)
        sphere(px, 76, 63, 12, skin, hi=0.4, lo=0.55)       # head
        px.ellipse([70*SS,58*SS,74*SS,63*SS], fill=(20,16,14,255))  # eye socket
        px.ellipse([73*SS,66*SS,82*SS,72*SS], fill=(30,12,12,255))  # gaping jaw
        m = silhouette_mask(L)
        tx = new(); mottle(tx, m, skin, 150); blood(tx, m, [(60,64),(78,68),(90,56)])
        L = Image.alpha_composite(L, tx)
    elif kind == "runner":
        skin, shirt = lerp(PALE,ROT,0.4), lerp(SHIRT,(40,44,50),0.3)
        capsule(px, (42, 60), (58, 60), 5, 6, lerp(shirt,(0,0,0),0.25))  # trailing leg
        capsule(px, (52, 78), (66, 88), 5, 6, lerp(shirt,(0,0,0),0.25))  # driving leg
        capsule(px, (56, 50), (60, 78), 12, 13, shirt)      # leaner torso
        capsule(px, (58, 74), (44, 84), 5.5, 3, skin)       # arm back (running)
        capsule(px, (62, 52), (100, 60), 5.5, 3, skin)      # arm forward lunge
        claw(px, skin, 100, 60, 0.0, spread=0.45)
        sphere(px, 74, 58, 10.5, skin, hi=0.45, lo=0.55)    # head, tilted forward
        px.ellipse([70*SS,54*SS,74*SS,58*SS], fill=(18,14,12,255))
        px.polygon([(74*SS,62*SS),(82*SS,60*SS),(80*SS,66*SS)], fill=(28,10,10,255))
        m = silhouette_mask(L)
        tx = new(); mottle(tx, m, skin, 110); blood(tx, m, [(74,58),(64,56)])
        L = Image.alpha_composite(L, tx)
    elif kind == "brute":
        skin = MUSCLE
        capsule(px, (44, 48), (58, 52), 7, 9, lerp(SHIRT,(0,0,0),0.3))
        capsule(px, (44, 80), (58, 76), 7, 9, lerp(SHIRT,(0,0,0),0.3))
        capsule(px, (56, 40), (58, 88), 23, 22, skin)       # massive torso
        capsule(px, (58, 44), (98, 46), 11, 6, skin)        # huge arms
        capsule(px, (58, 84), (96, 86), 11, 6, skin)
        claw(px, skin, 98, 46, -0.1, length=12, spread=0.4)
        claw(px, skin, 96, 86, 0.1, length=12, spread=0.4)
        sphere(px, 80, 64, 11, lerp(skin,(90,60,55),0.4), hi=0.35, lo=0.6)  # small sunken head
        px.ellipse([76*SS,60*SS,80*SS,64*SS], fill=(16,10,10,255))
        m = silhouette_mask(L)
        tx = new(); mottle(tx, m, skin, 200)
        # exposed muscle striations + bone
        d = ImageDraw.Draw(tx)
        for k in range(5):
            yy = (48 + k*8) * SS
            d.line([(50*SS, yy), (66*SS, yy)], fill=(90,40,38,120), width=SS)
        blood(tx, m, [(58,50),(58,80),(60,64)], big=True)
        L = Image.alpha_composite(L, tx)
    elif kind == "bloater":
        skin = BLOAT
        capsule(px, (48, 52), (60, 56), 6, 8, lerp(skin,(0,0,0),0.4))
        capsule(px, (48, 76), (60, 72), 6, 8, lerp(skin,(0,0,0),0.4))
        sphere(px, 62, 64, 25, skin, hi=0.4, lo=0.55)       # bloated round body
        capsule(px, (66, 48), (88, 46), 6, 4, skin)         # short arms
        capsule(px, (66, 80), (86, 82), 6, 4, skin)
        claw(px, skin, 88, 46, -0.1, length=7); claw(px, skin, 86, 82, 0.1, length=7)
        sphere(px, 82, 62, 9, lerp(skin,(120,140,80),0.5), hi=0.4, lo=0.5)
        m = silhouette_mask(L)
        tx = new(); mottle(tx, m, skin, 240)
        d = ImageDraw.Draw(tx)
        for _ in range(14):   # glowing gas pustules
            x = random.randint(50, 78)*SS; y = random.randint(50, 80)*SS
            r = random.randint(4, 8)*SS//2
            d.ellipse([x-r,y-r,x+r,y+r], fill=(180,230,110,150))
            d.ellipse([x-r//2,y-r//2,x+r//2,y+r//2], fill=(220,255,160,180))
        blood(tx, m, [(62,64),(70,54)])
        L = Image.alpha_composite(L, tx)
    elif kind == "screamer":
        skin = lerp(PALE,(120,130,130),0.5)
        capsule(px, (44, 58), (58, 60), 4, 5, lerp(SHIRT,(0,0,0),0.4))   # thin legs
        capsule(px, (46, 74), (60, 74), 4, 5, lerp(SHIRT,(0,0,0),0.4))
        capsule(px, (56, 50), (60, 80), 11, 10, skin)       # gaunt torso
        # emaciated ribs
        capsule(px, (60, 50), (102, 56), 4.5, 2.4, skin)    # long thin reaching arms
        capsule(px, (60, 80), (100, 74), 4.5, 2.4, skin)
        claw(px, skin, 102, 56, -0.1, length=11, spread=0.6)
        claw(px, skin, 100, 74, 0.05, length=11, spread=0.6)
        sphere(px, 78, 64, 12, skin, hi=0.45, lo=0.55)      # head
        # WIDE screaming mouth
        px.ellipse([76*SS,62*SS,88*SS,74*SS], fill=(20,8,10,255))
        px.ellipse([72*SS,58*SS,76*SS,62*SS], fill=(14,10,10,255))
        px.ellipse([74*SS,66*SS,78*SS,70*SS], fill=(14,10,10,255))
        m = silhouette_mask(L)
        tx = new(); mottle(tx, m, skin, 120)
        d = ImageDraw.Draw(tx)
        for k in range(4):
            yy=(54+k*6)*SS
            d.line([(52*SS,yy),(64*SS,yy)], fill=(200,195,175,90), width=SS)  # ribs
        blood(tx, m, [(78,68),(60,62)])
        L = Image.alpha_composite(L, tx)
    finish(L, kind, outdir)

def build_player(outdir):
    L = new(); px = ImageDraw.Draw(L)
    # legs behind
    capsule(px, (42, 56), (58, 58), 5.5, 6.5, lerp(JACKET,(0,0,0),0.25))
    capsule(px, (42, 72), (58, 70), 5.5, 6.5, lerp(JACKET,(0,0,0),0.25))
    # torso / tactical jacket (shoulders span y)
    capsule(px, (58, 48), (58, 80), 15, 15, JACKET)
    # chest rig detail
    px.rectangle([56*SS,58*SS,64*SS,70*SS], fill=(30,34,42,255))
    # arms forward in a ready/aim stance holding toward +x
    capsule(px, (60, 52), (90, 60), 6, 4, JACKET)
    capsule(px, (60, 76), (90, 68), 6, 4, JACKET)
    sphere(px, 91, 60, 4.2, PSKIN, hi=0.4, lo=0.4)   # gloved/skin hands
    sphere(px, 91, 68, 4.2, PSKIN, hi=0.4, lo=0.4)
    # hood (behind) then face (forward) so the hood reads as a rim, not a 2nd ball
    sphere(px, 70, 64, 12.5, (34, 38, 46), hi=0.35, lo=0.55)  # hood/hair
    sphere(px, 74, 64, 9.5, PSKIN, hi=0.5, lo=0.45)           # face, pushed forward
    m = silhouette_mask(L)
    tx = new()
    d = ImageDraw.Draw(tx)
    # subtle fabric shading + a small red survivor armband
    d.rectangle([58*SS,50*SS,62*SS,54*SS], fill=(150,30,30,220))
    blood(tx, m, [(60,64)], big=False)
    L = Image.alpha_composite(L, tx)
    finish(L, "player", outdir)

def main():
    outdir = sys.argv[1] if len(sys.argv) > 1 else "."
    for k in ("shambler", "runner", "brute", "bloater", "screamer"):
        build_zombie(k, outdir)
    build_player(outdir)
    print("chars ->", outdir)

if __name__ == "__main__":
    main()
