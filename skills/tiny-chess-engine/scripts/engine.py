import os
from json import dumps,load
from random import Random
B=[0]*128;SD=1;CST=0;EP=-1;HM=0;H=0;MG=0;EG=0;PH=0
KP=[0,0];NP=[0,0];BC=[0,0];U=[];RC={}
VM=[0,100,320,330,500,900,0];PW=[0,0,1,1,2,4,0]
PA=[0,0,5,10,20,35,60,0]
KF=[30,40,10,0,0,10,40,30]
KN=[31,33,14,18,-14,-18,-31,-33]
BD=[17,15,-17,-15];RD=[16,-16,1,-1];K8=BD+RD
SQ=[s for s in range(128)if not s&136]
KEEP=[15]*128
for _s,_v in((4,12),(0,13),(7,14),(116,3),(112,7),(119,11)):KEEP[_s]=_v
_R=Random(4177)
Z=[[ _R.getrandbits(64)for _ in range(128)]for _ in range(13)]
ZS=_R.getrandbits(64)
MATE=100000;INF=1000000;BUD=50000
TT=[None]*(1<<18);TM=(1<<18)-1
KIL=[[0,0]for _ in range(128)]
HI=[0]*16384
ND=0;AB=0
def rc(d):RC[H]=RC.get(H,0)+d
def pv(p,s):
 t=abs(p);w=VM[t];r=s>>4;f=s&7;rr=r if p>0 else 7-r
 cf=min(f,7-f);cr=min(rr,7-rr);c=cf+cr
 if t==1:m=w+PA[rr]+2*cf;e=w+PA[rr]*3//2+cf
 elif t==2:m=w+6*c-20+(10 if rr>=4 else 0);e=w+5*c-16
 elif t==3:m=w+4*c-10;e=w+4*c-6
 elif t==4:m=w+(18 if rr==6 else 0)+3*cf;e=w+2*cf
 elif t==5:m=w+3*c-8;e=w+4*c-12
 else:m=w+(KF[f]if rr==0 else-18*rr);e=w+9*c-36
 return(m,e)if p>0 else(-m,-e)
def ev():
 mg=MG;eg=EG
 if BC[1]>=2:mg+=28;eg+=44
 if BC[0]>=2:mg-=28;eg-=44
 s=(mg*PH+eg*(24-PH))//24
 return s*SD
def att(s,by):
 for u in(s-15*by,s-17*by):
  if not u&136 and B[u]==by:return 1
 for ds,tt in((KN,2),(K8,6)):
  for d in ds:
   u=s+d
   if not u&136 and B[u]==tt*by:return 1
 for ds,tt in((BD,3),(RD,4)):
  for d in ds:
   u=s+d
   while not u&136:
    p=B[u]
    if p:
     if p==tt*by or p==5*by:return 1
     break
    u+=d
 return 0
def gen(cap=0):
 ms=[];ap=ms.append;sd=SD
 for s in SQ:
  p=B[s]
  if not p or p*sd<0:continue
  t=abs(p)
  if t==1:
   d=16*sd;one=s+d
   if not B[one]:
    if one>>4 in(0,7):
     for pr in(5,4,3,2):ap(s|one<<7|pr<<14)
    elif not cap:
     ap(s|one<<7)
     if(s>>4)==(1 if sd>0 else 6)and not B[one+d]:ap(s|one+d<<7)
   for dd in(d-1,d+1):
    u=s+dd
    if u&136:continue
    q=B[u]
    if q and q*sd<0:
     if u>>4 in(0,7):
      for pr in(5,4,3,2):ap(s|u<<7|pr<<14)
     else:ap(s|u<<7)
    elif u==EP:ap(s|u<<7)
  elif t==2 or t==6:
   for d in(KN if t==2 else K8):
    u=s+d
    if u&136:continue
    q=B[u]
    if not q:
     if not cap:ap(s|u<<7)
    elif q*sd<0:ap(s|u<<7)
   if t==6 and not cap and s in(4,116):
    e=-sd;cb=1 if sd>0 else 4
    if CST&cb and not B[s+1]and not B[s+2]and not att(s,e)and not att(s+1,e)and not att(s+2,e):ap(s|s+2<<7)
    if CST&cb*2 and not B[s-1]and not B[s-2]and not B[s-3]and not att(s,e)and not att(s-1,e)and not att(s-2,e):ap(s|s-2<<7)
  else:
   for d in(BD if t==3 else RD if t==4 else K8):
    u=s+d
    while not u&136:
     q=B[u]
     if not q:
      if not cap:ap(s|u<<7)
     else:
      if q*sd<0:ap(s|u<<7)
      break
     u+=d
 return ms
def make(m):
 global SD,CST,EP,HM,H,MG,EG,PH
 f=m&127;t=(m>>7)&127;pr=(m>>14)&7
 p=B[f];cs=t;cap=B[t]
 if abs(p)==1 and t==EP and not cap and(f&7)!=(t&7):cs=t-16*SD;cap=B[cs]
 U.append((m,cap,cs,CST,EP,H,MG,EG,PH,HM))
 if cap:
  B[cs]=0;dm,de=pv(cap,cs);MG-=dm;EG-=de;PH-=PW[abs(cap)];H^=Z[cap+6][cs]
  if abs(cap)>1:NP[cap>0]-=VM[abs(cap)]
  if abs(cap)==3:BC[cap>0]-=1
 dm,de=pv(p,f);MG-=dm;EG-=de;H^=Z[p+6][f]
 pl=pr*SD if pr else p
 dm,de=pv(pl,t);MG+=dm;EG+=de;H^=Z[pl+6][t]
 if pr:
  PH+=PW[pr];NP[SD>0]+=VM[pr]
  if pr==3:BC[SD>0]+=1
 B[f]=0;B[t]=pl
 if abs(p)==6:
  KP[SD>0]=t
  if abs(t-f)==2:
   rf,rt=(f+3,f+1)if t>f else(f-4,f-1)
   rk=B[rf];dm,de=pv(rk,rf);MG-=dm;EG-=de;H^=Z[rk+6][rf]
   B[rf]=0;B[rt]=rk;dm,de=pv(rk,rt);MG+=dm;EG+=de;H^=Z[rk+6][rt]
 H^=Z[6][CST];CST&=KEEP[f]&KEEP[t];H^=Z[6][CST]
 if EP>=0:H^=Z[6][16+(EP&7)]
 EP=(f+t)//2 if abs(p)==1 and abs(t-f)==32 else-1
 if EP>=0:H^=Z[6][16+(EP&7)]
 HM=0 if abs(p)==1 or cap else HM+1
 SD=-SD;H^=ZS;rc(1)
def mnull():
 global SD,EP,H
 U.append((-1,0,0,CST,EP,H,MG,EG,PH,HM))
 if EP>=0:H^=Z[6][16+(EP&7)]
 EP=-1;SD=-SD;H^=ZS;rc(1)
def un():
 global SD,CST,EP,HM,H,MG,EG,PH
 rc(-1)
 m,cap,cs,CST,EP,H,MG,EG,PH,HM=U.pop()
 SD=-SD
 if m<0:return
 f=m&127;t=(m>>7)&127;pr=(m>>14)&7;p=B[t]
 if pr:
  p=SD
  NP[SD>0]-=VM[pr]
  if pr==3:BC[SD>0]-=1
 B[f]=p;B[t]=0
 if abs(p)==6:
  KP[SD>0]=f
  if abs(t-f)==2:
   rf,rt=(f+3,f+1)if t>f else(f-4,f-1)
   B[rf]=B[rt];B[rt]=0
 if cap:
  B[cs]=cap
  if abs(cap)>1:NP[cap>0]+=VM[abs(cap)]
  if abs(cap)==3:BC[cap>0]+=1
def lat(s,sd):
 bv=99999;bs=-1
 for u in(s-15*sd,s-17*sd):
  if not u&136 and B[u]==sd:return u,100
 for ds,tt,vv in((KN,2,320),(K8,6,20000)):
  for d in ds:
   u=s+d
   if not u&136 and B[u]==tt*sd and vv<bv:bv=vv;bs=u
 for ds,t1,t2 in((BD,3,5),(RD,4,5)):
  for d in ds:
   u=s+d
   while not u&136:
    p=B[u]
    if p:
     if p*sd>0 and abs(p)in(t1,t2):
      vv=330 if abs(p)==3 else 500 if abs(p)==4 else 900
      if vv<bv:bv=vv;bs=u
     break
    u+=d
 return bs,bv
def see(m):
 f=m&127;t=(m>>7)&127
 if not B[t]:return 0
 st=[(f,B[t])];g=[VM[abs(B[t])]]
 B[t]=B[f];B[f]=0;vv=VM[abs(B[t])]or 20000;sd=-SD
 while 1:
  a,av=lat(t,sd)
  if a<0:break
  g.append(vv-g[-1]);vv=av;st.append((a,B[t]));B[t]=B[a];B[a]=0;sd=-sd
 for a,cp in reversed(st):B[a]=B[t];B[t]=cp
 d=len(g)-1
 while d>0:
  g[d-1]=-max(-g[d-1],g[d]);d-=1
 return g[0]
def qs(a,b,ply):
 global ND,AB
 ND+=1
 if ND>=BUD:AB=1;return ev()
 chk=att(KP[SD>0],-SD)
 if ply>64:return ev()
 if chk:best=-INF;ms=gen()
 else:
  best=ev()
  if best>=b:return best
  if best>a:a=best
  ms=gen(1)
 sc=sorted(((10*VM[abs(B[m>>7&127])]if B[m>>7&127]else(900 if m>>14&7 else 0),m)for m in ms),reverse=True)
 legal=0
 for _,m in sc:
  if not chk:
   t=(m>>7)&127;q=B[t];pr=(m>>14)&7
   if q and not pr and(best+VM[abs(q)]+200<a or see(m)<0):continue
  make(m)
  if att(KP[SD<0],SD):un();continue
  legal+=1;s=-qs(-b,-a,ply+1);un()
  if AB:return 0
  if s>best:best=s
  if s>=b:return s
  if s>a:a=s
 if chk and not legal:return-MATE+ply
 return best
def neg(d,a,b,ply,nn=1):
 global ND,AB
 if ply>0 and(HM>=100 or RC.get(H,0)>1):return 0
 if d<=0:return qs(a,b,ply)
 chk=att(KP[SD>0],-SD)
 if chk:d+=1
 ND+=1
 if ND>=BUD:AB=1;return ev()
 if ply>0:
  if a<-MATE+ply:a=-MATE+ply
  if b>MATE-ply-1:b=MATE-ply-1
  if a>=b:return a
 e=TT[H&TM];tm=0
 if e and e[0]==H:
  tm=e[3]
  if e[1]>=d:
   s=e[2]
   if e[4]==0 or(e[4]==1 and s>=b)or(e[4]==2 and s<=a):return s
 if nn and ply>1 and not chk and d>=3 and b<MATE-1000 and NP[SD>0]>0 and ev()>=b:
  mnull();s=-neg(d-3,-b,-b+1,ply+1,0);un()
  if AB:return 0
  if s>=b:return s
 ms=gen()
 def kf(m):
  if m==tm:return 1<<28
  f=m&127;t=(m>>7)&127;pr=(m>>14)&7;q=B[t]
  if not q and abs(B[f])==1 and t==EP:q=SD
  if q:
   if VM[abs(q)]<VM[abs(B[f])]:
    sv=see(m)
    if sv<0:return sv
   return(1<<24)+10*VM[abs(q)]-abs(B[f])
  if pr:return(1<<24)+VM[pr]
  if m==KIL[ply][0]:return 1<<22
  if m==KIL[ply][1]:return(1<<22)-1
  return HI[(f<<7)|t]
 ms.sort(key=kf,reverse=True)
 legal=0;best=-INF;bm=0;a0=a
 for m in ms:
  f=m&127;t=(m>>7)&127;pr=(m>>14)&7
  iscap=B[t]!=0 or pr!=0 or(abs(B[f])==1 and t==EP)
  make(m)
  if att(KP[SD<0],SD):un();continue
  legal+=1
  if legal==1:s=-neg(d-1,-b,-a,ply+1)
  else:
   r=0
   if d>=3 and legal>3 and not iscap and not chk:r=2 if legal>10 and d>=5 else 1
   s=-neg(d-1-r,-a-1,-a,ply+1)
   if s>a and r:s=-neg(d-1,-a-1,-a,ply+1)
   if s>a and s<b:s=-neg(d-1,-b,-a,ply+1)
  un()
  if AB:return 0
  if s>best:best=s;bm=m
  if s>a:a=s
  if a>=b:
   if not iscap:
    HI[(f<<7)|t]+=d*d
    if KIL[ply][0]!=m:KIL[ply][1]=KIL[ply][0];KIL[ply][0]=m
   break
 if not legal:return-MATE+ply if chk else 0
 fl=2 if best<=a0 else 1 if best>=b else 0
 TT[H&TM]=(H,d,best,bm,fl)
 return best
def best():
 global ND,AB
 ND=0;AB=0
 rc(1)
 ms=[]
 for m in gen():
  make(m)
  if not att(KP[SD<0],SD):ms.append(m)
  un()
 bm=ms[0];order=[[0,m]for m in ms];d=1
 while d<=64:
  a=-INF;ab=0
  for o in order:
   make(o[1]);o[0]=-neg(d-1,-MATE-1,-a,1);un()
   if AB:ab=1;break
   if o[0]>a:a=o[0]
  if ab:break
  order.sort(key=lambda o:-o[0]);bm=order[0][1]
  if a>=MATE-1000:break
  d+=1
 rc(-1)
 return bm
def fp(fen):
 global SD,CST,EP,HM,H,MG,EG,PH
 for s in SQ:B[s]=0
 MG=0;EG=0;PH=0;NP[0]=NP[1]=0;BC[0]=BC[1]=0;RC.clear()
 ps=fen.split();s=112;H=0
 for ch in ps[0]:
  if ch=="/":s-=24
  elif ch.isdigit():s+=int(ch)
  else:
   p="pnbrqk".index(ch.lower())+1
   if ch.islower():p=-p
   B[s]=p;H^=Z[p+6][s]
   dm,de=pv(p,s);MG+=dm;EG+=de;PH+=PW[abs(p)]
   if abs(p)==6:KP[p>0]=s
   if abs(p)>1:NP[p>0]+=VM[abs(p)]
   if abs(p)==3:BC[p>0]+=1
   s+=1
 SD=1 if ps[1]=="w"else-1
 CST=sum((1,2,4,8)[i]for i,ch in enumerate("KQkq")if ch in ps[2])
 EP=-1 if ps[3]=="-"else ord(ps[3][0])-97+(ord(ps[3][1])-49)*16
 HM=int(ps[4])if len(ps)>4 else 0
 if SD<0:H^=ZS
 H^=Z[6][CST]
 if EP>=0:H^=Z[6][16+(EP&7)]
def uci(m):
 f=m&127;t=(m>>7)&127;pr=(m>>14)&7
 return"abcdefgh"[f&7]+str((f>>4)+1)+"abcdefgh"[t&7]+str((t>>4)+1)+("  nbrq"[pr]if pr else"")
def choose(fen,lm):
 fp(fen);u=uci(best())
 if u in lm:return u
 return lm[0]
