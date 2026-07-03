import math, random, sys
from PIL import Image, ImageDraw
sys.path.insert(0, __import__("os").path.dirname(__file__))
from gen_char import SS, C, S, new, sphere, capsule, lerp, finish, silhouette_mask
random.seed(11)

def build_hound(outdir):
    L = new(); px = ImageDraw.Draw(L)
    fur = (40, 30, 30); ember = (150, 60, 24)
    capsule(px, (42, 60), (36, 52), 4, 2, fur)
    capsule(px, (44, 64), (74, 64), 11, 9, fur)
    for (bx, by, fx, fy) in [(50,54,44,44),(50,74,44,84),(68,54,74,44),(68,74,74,84)]:
        capsule(px, (bx, by), (fx, fy), 4, 2.5, lerp(fur,(0,0,0),0.3))
    sphere(px, 80, 64, 10, fur, hi=0.3, lo=0.55)
    capsule(px, (84, 64), (94, 64), 5, 3, fur)
    px.polygon([(94*SS,62*SS),(100*SS,64*SS),(94*SS,66*SS)], fill=(20,14,14,255))
    m = silhouette_mask(L)
    tx = new(); d = ImageDraw.Draw(tx)
    for _ in range(70):
        x = random.randint(44, 90)*SS; y = random.randint(52, 76)*SS
        if m.getpixel((min(S-1,x), min(S-1,y))) < 30: continue
        r = random.randint(2,5)*SS//2
        d.ellipse([x-r,y-r,x+r,y+r], fill=lerp(ember,(255,140,40), random.random())+(random.randint(40,120),))
    for ey in (60, 68):
        d.ellipse([80*SS-3*SS,ey*SS-2*SS,80*SS+2*SS,ey*SS+2*SS], fill=(255,150,40,255))
        d.ellipse([80*SS-1*SS,ey*SS-1*SS,80*SS+1*SS,ey*SS+1*SS], fill=(255,230,150,255))
    L = Image.alpha_composite(L, tx)
    finish(L, "hound", outdir)

def build_raygun(outdir):
    L = new(); px = ImageDraw.Draw(L)
    body = (46, 74, 58)
    capsule(px, (52, 64), (86, 62), 7, 5, body)
    capsule(px, (56, 66), (54, 82), 6, 5, lerp(body,(0,0,0),0.2))
    sphere(px, 66, 62, 8, (40, 120, 70), hi=0.5, lo=0.4)
    m = silhouette_mask(L)
    tx = new(); d = ImageDraw.Draw(tx)
    d.ellipse([62*SS,58*SS,70*SS,66*SS], fill=(120,255,150,180))
    d.ellipse([84*SS,59*SS,92*SS,65*SS], fill=(150,255,170,150))
    for _ in range(30):
        x=random.randint(54,84)*SS; y=random.randint(58,66)*SS
        if m.getpixel((min(S-1,x),min(S-1,y)))<30: continue
        d.ellipse([x-2*SS,y-2*SS,x+2*SS,y+2*SS], fill=(120,220,140,60))
    L = Image.alpha_composite(L, tx)
    finish(L, "wpn_raygun", outdir)

outdir = sys.argv[1] if len(sys.argv) > 1 else "."
build_hound(outdir); build_raygun(outdir)
print("props ->", outdir)
