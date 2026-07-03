import sys
from PIL import Image, ImageDraw, ImageFilter
SS=4; C=128; S=C*SS
def new(): return Image.new("RGBA",(S,S),(0,0,0,0))
def rr(d,box,r,fill): d.rounded_rectangle([v*SS for v in box],radius=r*SS,fill=fill)
L=new(); d=ImageDraw.Draw(L)
# medkit: dark shell + lighter top face + red cross
rr(d,(40,44,88,86),9,(24,30,26,255))          # shell/outline base
rr(d,(43,47,85,83),8,(70,84,66,255))           # olive body
rr(d,(46,50,82,66),6,(96,112,88,255))          # top bevel highlight
# red cross
d.rectangle([58*SS,52*SS,70*SS,78*SS],fill=(200,40,40,255))
d.rectangle([51*SS,59*SS,77*SS,71*SS],fill=(200,40,40,255))
d.rectangle([60*SS,54*SS,68*SS,76*SS],fill=(235,70,64,255))  # cross highlight
d.rectangle([53*SS,61*SS,75*SS,69*SS],fill=(235,70,64,255))
L=L.filter(ImageFilter.GaussianBlur(SS*0.4)).resize((C,C),Image.LANCZOS)
L.save(sys.argv[1]+"/health.png")
print("health ->",sys.argv[1])
