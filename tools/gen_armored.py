import random, sys
from PIL import Image, ImageDraw
sys.path.insert(0, __import__("os").path.dirname(__file__))
from gen_char import SS, C, S, new, sphere, capsule, claw, lerp, finish, silhouette_mask, mottle, blood
random.seed(31)

def build_armored(outdir):
    L=new(); px=ImageDraw.Draw(L)
    steel=(112,118,128); dark=(72,76,84); skin=(120,110,100)
    # legs (armored greaves)
    capsule(px,(42,54),(58,56),6,7,dark); capsule(px,(42,74),(58,72),6,7,dark)
    # bulky armored torso
    capsule(px,(56,44),(58,84),18,17,steel)
    # chest plate + rivets
    px.rounded_rectangle([54*SS,56*SS,66*SS,72*SS],radius=3*SS,fill=(96,102,112,255))
    # shoulder pauldrons
    sphere(px,58,46,9,dark,hi=0.4,lo=0.55); sphere(px,58,82,9,dark,hi=0.4,lo=0.55)
    # armored arms reaching
    capsule(px,(60,48),(94,52),7,4,steel); capsule(px,(60,80),(92,78),7,4,steel)
    claw(px,skin,94,52,-0.1,length=6); claw(px,skin,92,78,0.1,length=6)
    # helmet + dark visor
    sphere(px,76,64,12,lerp(steel,(90,96,104),0.3),hi=0.45,lo=0.5)
    px.rounded_rectangle([78*SS,60*SS,88*SS,68*SS],radius=2*SS,fill=(20,24,30,255))  # visor slit
    px.rectangle([80*SS,63*SS,86*SS,65*SS],fill=(150,30,30,255))                     # red glow in visor
    m=silhouette_mask(L); tx=new(); d=ImageDraw.Draw(tx)
    # rivets on the plating
    for (rx,ry) in [(55,58),(65,58),(55,70),(65,70),(58,46),(58,82)]:
        d.ellipse([rx*SS-2*SS,ry*SS-2*SS,rx*SS+2*SS,ry*SS+2*SS],fill=(150,156,164,220))
    # scratches + a little rust/blood
    for _ in range(26):
        x=random.randint(52,72)*SS; y=random.randint(46,82)*SS
        if m.getpixel((min(S-1,x),min(S-1,y)))<30: continue
        d.line([(x,y),(x+random.randint(3,7)*SS, y+random.randint(-2,2)*SS)],fill=(50,54,60,120),width=SS)
    blood(tx,m,[(60,64),(76,64)])
    L=Image.alpha_composite(L,tx); finish(L,"armored",outdir)

outdir=sys.argv[1] if len(sys.argv)>1 else "."
build_armored(outdir); print("armored ->",outdir)
