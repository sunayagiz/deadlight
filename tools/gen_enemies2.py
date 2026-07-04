import random, sys
from PIL import Image, ImageDraw
sys.path.insert(0, __import__("os").path.dirname(__file__))
from gen_char import SS, C, S, new, sphere, capsule, claw, lerp, finish, silhouette_mask, mottle, blood
random.seed(23)

def build_spitter(outdir):
    L=new(); px=ImageDraw.Draw(L)
    acid=(140,164,78); sac=(120,150,60)
    # legs + bloated acid-sac torso
    capsule(px,(44,56),(58,58),5,6,lerp(sac,(0,0,0),0.3))
    capsule(px,(44,74),(58,72),5,6,lerp(sac,(0,0,0),0.3))
    sphere(px,60,64,19,sac,hi=0.4,lo=0.55)          # swollen sac
    capsule(px,(66,52),(88,52),5,3,acid); capsule(px,(66,78),(86,78),5,3,acid)  # short arms
    claw(px,acid,88,52,-0.1,length=6); claw(px,acid,86,78,0.1,length=6)
    sphere(px,80,62,11,acid,hi=0.45,lo=0.5)         # head, tilted up to spit
    px.ellipse([82*SS,60*SS,92*SS,68*SS],fill=(18,26,10,255))  # open spitting mouth
    m=silhouette_mask(L); tx=new(); mottle(tx,m,acid,180); d=ImageDraw.Draw(tx)
    for _ in range(16):  # glowing acid pockets in the sac
        x=random.randint(50,72)*SS; y=random.randint(52,78)*SS; r=random.randint(3,6)*SS//2
        d.ellipse([x-r,y-r,x+r,y+r],fill=(180,240,90,150))
    d.ellipse([88*SS,61*SS,96*SS,67*SS],fill=(170,240,90,170))  # acid drip at mouth
    L=Image.alpha_composite(L,tx); finish(L,"spitter",outdir)

def build_boomer(outdir):
    L=new(); px=ImageDraw.Draw(L)
    flesh=(150,92,72)
    capsule(px,(48,54),(60,56),6,8,lerp(flesh,(0,0,0),0.4))
    capsule(px,(48,74),(60,72),6,8,lerp(flesh,(0,0,0),0.4))
    sphere(px,62,64,23,flesh,hi=0.42,lo=0.55)       # very round, about to burst
    capsule(px,(68,50),(84,48),5,3,flesh); capsule(px,(68,80),(84,82),5,3,flesh)
    claw(px,flesh,84,48,-0.1,length=5); claw(px,flesh,84,82,0.1,length=5)
    sphere(px,80,62,8,lerp(flesh,(120,70,60),0.4),hi=0.4,lo=0.5)
    m=silhouette_mask(L); tx=new(); mottle(tx,m,flesh,220); d=ImageDraw.Draw(tx)
    for _ in range(18):  # volatile glowing pockets (about to explode)
        x=random.randint(48,78)*SS; y=random.randint(50,80)*SS; r=random.randint(4,8)*SS//2
        d.ellipse([x-r,y-r,x+r,y+r],fill=(255,120,40,150))
        d.ellipse([x-r//2,y-r//2,x+r//2,y+r//2],fill=(255,190,90,190))
    blood(tx,m,[(62,64),(70,54)])
    L=Image.alpha_composite(L,tx); finish(L,"boomer",outdir)

def build_stalker(outdir):
    L=new(); px=ImageDraw.Draw(L)
    skin=(142,140,132)
    capsule(px,(42,58),(58,60),4,5,lerp(skin,(0,0,0),0.35))  # thin trailing legs
    capsule(px,(48,74),(62,74),4,5,lerp(skin,(0,0,0),0.35))
    capsule(px,(54,52),(62,78),9,8,skin)            # lean crouched torso
    capsule(px,(60,54),(104,58),4.5,2.2,skin)       # long reaching arms
    capsule(px,(60,78),(102,72),4.5,2.2,skin)
    claw(px,skin,104,58,-0.1,length=12,spread=0.55)
    claw(px,skin,102,72,0.05,length=12,spread=0.55)
    sphere(px,78,66,9,lerp(skin,(110,110,104),0.3),hi=0.45,lo=0.55)  # low predatory head
    px.ellipse([76*SS,64*SS,80*SS,67*SS],fill=(150,20,20,255))       # red eye
    m=silhouette_mask(L); tx=new(); mottle(tx,m,skin,110)
    d=ImageDraw.Draw(tx)
    for k in range(4):  # sinewy ribs
        yy=(56+k*6)*SS; d.line([(54*SS,yy),(64*SS,yy)],fill=(180,178,168,90),width=SS)
    blood(tx,m,[(78,66)])
    L=Image.alpha_composite(L,tx); finish(L,"stalker",outdir)

outdir=sys.argv[1] if len(sys.argv)>1 else "."
build_spitter(outdir); build_boomer(outdir); build_stalker(outdir)
print("enemies2 ->",outdir)
