import wave, struct, math, random
SR=44100
def w(name, samples):
    with wave.open(f"/Users/ovguhan/Github/deadlight/public/assets/audio/{name}.wav","w") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes(b''.join(struct.pack('<h', max(-32767,min(32767,int(s*32767)))) for s in samples))
# tension drone: low detuned saws + a slow 2-per-sec pulse, ~8s loop
def tension():
    dur=8.0; n=int(SR*dur); out=[]
    random.seed(5)
    for i in range(n):
        t=i/SR
        # low drone (two detuned oscillators, minor-ish)
        d = 0.16*math.sin(2*math.pi*55*t) + 0.12*math.sin(2*math.pi*55.4*t) + 0.10*math.sin(2*math.pi*82.4*t)
        # slow pulse envelope (2 Hz) shaping a noise/perc hit
        ph=(t*2.0)%1.0
        env=math.exp(-ph*7)
        perc=env*0.22*(random.random()*2-1)
        # subtle high shimmer that swells
        sh=0.05*math.sin(2*math.pi*220*t)*(0.5+0.5*math.sin(2*math.pi*0.25*t))
        s=d+perc+sh
        # gentle fade at loop ends to avoid clicks
        if i<800: s*=i/800
        if i>n-800: s*=(n-i)/800
        out.append(s*0.9)
    return out
# boss sting: descending low brass-ish hit ~1.2s
def sting():
    dur=1.4; n=int(SR*dur); out=[]
    for i in range(n):
        t=i/SR; env=math.exp(-t*2.2)
        f=140*(1-0.4*t)  # descending
        s=env*(0.5*math.sin(2*math.pi*f*t)+0.25*math.sin(2*math.pi*f*2*t)+0.12*(random.random()*2-1)*math.exp(-t*8))
        out.append(s*0.9)
    return out
w("music_tension", tension()); w("sting_boss", sting())
print("music_tension.wav + sting_boss.wav generated")
