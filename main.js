window.addEventListener('error',e=>{document.getElementById('err').textContent+=(e.message||e)+'\n'});
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------- utilities
const TAU=Math.PI*2;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)), lerp=(a,b,t)=>a+(b-a)*t;
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const toHex=(r,g,b)=>'#'+[r,g,b].map(v=>Math.round(clamp(v,0,255)).toString(16).padStart(2,'0')).join('');
function densify(pts,step){const o=[];for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/step));
  for(let k=0;k<n;k++)o.push([lerp(a[0],b[0],k/n),lerp(a[1],b[1],k/n)])}return o}
function offsetPoly(pts,d){const n=pts.length;return pts.map((p,i)=>{const a=pts[(i-1+n)%n],b=pts[(i+1)%n];
  let e1x=p[0]-a[0],e1y=p[1]-a[1],l1=Math.hypot(e1x,e1y)||1;e1x/=l1;e1y/=l1;let e2x=b[0]-p[0],e2y=b[1]-p[1],l2=Math.hypot(e2x,e2y)||1;e2x/=l2;e2y/=l2;
  let mx=e1y+e2y,my=-e1x-e2x;const ml=Math.hypot(mx,my)||1;mx/=ml;my/=ml;const c=Math.max(mx*e1y-my*e1x,.75);return[p[0]+mx*d/c,p[1]+my*d/c]})}
const TY={ANT:1,CATH:2,OPAL:3,CLEAR:4,BEVEL:5,JEWEL:6,FROST:7,HAMM:8,IRID:9};
const TYNAME={1:'antique pot-metal',2:'textured rolled',3:'opalescent',4:'clear',5:'bevelled',6:'jewel',7:'acid-etched',8:'hammered',9:'iridised'};
function rgb2hsl(r,g,b){const mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2;let h=0,s=0;
  if(mx!==mn){const d=mx-mn;s=l>.5?d/(2-mx-mn):d/(mx+mn);h=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4;h/=6}return[h,s,l]}

function edt(seed,W,H){const INF=1e20,n=Math.max(W,H),f=new Float64Array(n),d=new Float64Array(n),z=new Float64Array(n+1),v=new Int32Array(n),g=new Float32Array(W*H);
  for(let i=0;i<W*H;i++)g[i]=seed[i]?0:INF;
  const pass=len=>{let k=0;v[0]=0;z[0]=-INF;z[1]=INF;
    for(let q=1;q<len;q++){let s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);while(s<=z[k]){k--;s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k])}k++;v[k]=q;z[k]=s;z[k+1]=INF}
    k=0;for(let q=0;q<len;q++){while(z[k+1]<q)k++;const r=v[k];d[q]=(q-r)*(q-r)+f[r]}};
  for(let x=0;x<W;x++){for(let y=0;y<H;y++)f[y]=g[y*W+x];pass(H);for(let y=0;y<H;y++)g[y*W+x]=d[y]}
  for(let y=0;y<H;y++){const o=y*W;for(let x=0;x<W;x++)f[x]=g[o+x];pass(W);for(let x=0;x<W;x++)g[o+x]=Math.sqrt(d[x])}
  return g}

// ---------------------------------------------------------------- photograph -> glass
const loadImg=src=>new Promise((res,rej)=>{const i=new Image();i.decoding='async';i.onload=()=>res(i);i.onerror=()=>rej(new Error('Could not load '+src));i.src=src});
function pixels(img){const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(img,0,0);return x.getImageData(0,0,c.width,c.height).data}
// hallmark coordinates are written as percentages of the source photograph; convert to the cropped window
const toCrop=(st,x,y)=>{const[c0,r0,c1,r1]=st.crop;return[(x/100-c0)/(c1-c0),(y/100-r0)/(r1-r0)]};

async function fromPhoto(key,st){
  if(!META)META=await(await fetch('windows/meta.json?v='+ASSET_V)).json();
  const m=META[key];
  const[ci,li,ii]=await Promise.all([loadImg(`windows/${key}_c.jpg?v=${ASSET_V}`),loadImg(`windows/${key}_l.png?v=${ASSET_V}`),m.iron?loadImg(`windows/${key}_i.png?v=${ASSET_V}`):null]);
  const W=m.w,H=m.h,N=W*H,A=H/W,col=pixels(ci),ln=pixels(li),irn=ii?pixels(ii):null,r2=mulberry(key.length*977+3);
  const mask=new Uint8Array(N),glass=new Uint8Array(N);
  for(let i=0,j=0;i<N;i++,j+=4){mask[i]=ln[j+2]>127?1:0;glass[i]=mask[i]&&ln[j]<6&&!(irn&&irn[j]>127)?1:0}
  // pieces = connected glass regions bounded by came
  const lab=new Int32Array(N).fill(-1),par=new Int32Array(N);let nl=0;
  const find=a=>{while(par[a]!==a){par[a]=par[par[a]];a=par[a]}return a};
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(!glass[i])continue;const l=x>0?lab[i-1]:-1,u=y>0?lab[i-W]:-1;
    if(l<0&&u<0){par[nl]=nl;lab[i]=nl++}else if(l>=0&&u>=0){lab[i]=l;const a=find(l),b=find(u);if(a!==b)par[Math.max(a,b)]=Math.min(a,b)}else lab[i]=l>=0?l:u}
  const remap=new Int32Array(nl).fill(-1);let nc=0;
  for(let i=0;i<N;i++)if(lab[i]>=0){const rt=find(lab[i]);if(remap[rt]<0)remap[rt]=nc++;lab[i]=remap[rt]}
  const notGlass=new Uint8Array(N);for(let i=0;i<N;i++)notGlass[i]=glass[i]?0:1;
  const dist=edt(notGlass,W,H);
  const sr=new Float32Array(nc),sg=new Float32Array(nc),sb=new Float32Array(nc),cnt=new Uint32Array(nc),dmax=new Float32Array(nc);
  for(let i=0,j=0;i<N;i++,j+=4){const L=lab[i];if(L<0)continue;sr[L]+=col[j];sg[L]+=col[j+1];sb[L]+=col[j+2];cnt[L]++;if(dist[i]>dmax[L])dmax[L]=dist[i]}
  const ctype=new Uint8Array(nc),copal=new Float32Array(nc),cclear=new Uint8Array(nc),seedV=new Uint8Array(nc),vary=new Float32Array(nc);
  for(let c=0;c<nc;c++){const r=sr[c]/cnt[c]/255,g=sg[c]/cnt[c]/255,b=sb[c]/cnt[c]/255,[h,s,l]=rgb2hsl(r,g,b);
    const t=st.glassType({r,g,b,h,s,l,area:cnt[c]/N,round:dmax[c]*dmax[c]*Math.PI/cnt[c],rnd:r2()});
    ctype[c]=t[0];copal[c]=t[1]||0;cclear[c]=t[2]?1:0;seedV[c]=1+Math.floor(r2()*254);vary[c]=1+(r2()-.5)*st.vary}
  // hallmark regions
  const feat=new Uint8Array(N);
  for(const hm of st.hall){if(!hm.r)continue;const[cu,ct]=toCrop(st,hm.r[0],hm.r[1]),rx=hm.r[2]/100/(st.crop[2]-st.crop[0]),ry=hm.r[3]/100/(st.crop[3]-st.crop[1]);
    const y0=Math.max(0,Math.floor((ct-ry)*H)),y1=Math.min(H-1,Math.ceil((ct+ry)*H)),x0=Math.max(0,Math.floor((cu-rx)*W)),x1=Math.min(W-1,Math.ceil((cu+rx)*W));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const dx=(x/W-cu)/rx,dy=(y/H-ct)/ry;if(dx*dx+dy*dy<=1)feat[y*W+x]=hm.f}}
  // solder where three or more pieces meet
  const hw=m.hw,R=Math.round(hw*2.2+3),dirs=[];for(let k=0;k<12;k++){const a=k/12*TAU;dirs.push(Math.round(Math.cos(a)*R),Math.round(Math.sin(a)*R))}
  const cell=R*1.6,grid=new Map(),blobs=[];
  for(let y=R;y<H-R;y+=1)for(let x=R;x<W-R;x++){const i=y*W+x,j=i*4;if(!mask[i]||ln[j]<240||(irn&&irn[j]>127))continue;
    let a=-1,b=-1,c=-1;for(let k=0;k<24;k+=2){const L=lab[(y+dirs[k+1])*W+x+dirs[k]];if(L<0||L===a||L===b)continue;if(a<0)a=L;else if(b<0)b=L;else{c=L;break}}
    if(c<0)continue;const gx=Math.floor(x/cell),gy=Math.floor(y/cell);let hit=null;
    for(let oy=-1;oy<=1&&!hit;oy++)for(let ox=-1;ox<=1&&!hit;ox++){const arr=grid.get((gx+ox)+','+(gy+oy));if(arr)for(const bl of arr){if(Math.hypot(bl.sx/bl.n-x,bl.sy/bl.n-y)<cell){hit=bl;break}}}
    if(hit){hit.sx+=x;hit.sy+=y;hit.n++}else{const bl={sx:x,sy:y,n:1};blobs.push(bl);const k2=gx+','+gy;if(!grid.has(k2))grid.set(k2,[]);grid.get(k2).push(bl)}}
  const sold=new Uint8Array(N);
  for(const bl of blobs){const cx=bl.sx/bl.n,cy=bl.sy/bl.n,rs=hw*(1.05+.25*r2());
    for(let y=Math.max(0,Math.floor(cy-rs));y<=Math.min(H-1,Math.ceil(cy+rs));y++)for(let x=Math.max(0,Math.floor(cx-rs));x<=Math.min(W-1,Math.ceil(cx+rs));x++){
      const d=Math.hypot(x-cx,y-cy)/rs;if(d<1){const i=y*W+x,v=Math.sqrt(1-d*d)*255;if(v>sold[i])sold[i]=v}}}
  // pack textures, rows flipped so v runs upward
  const lin=new Float32Array(256);for(let i=0;i<256;i++){const c=i/255;lin[i]=c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4)}
  const toS=new Uint8Array(4096);for(let i=0;i<4096;i++){const v=i/4095;toS[i]=Math.round((v<=.0031308?v*12.92:1.055*Math.pow(v,1/2.4)-.055)*255)}
  const G=new Uint8Array(N*4),S=new Uint8Array(N*4),I=new Uint8Array(N*4),LT=new Uint8Array(N*4);
  let ar=0,ag=0,ab=0,am=0;const tcount={},pal=new Map();
  for(let y=0;y<H;y++){const yo=(H-1-y)*W;for(let x=0;x<W;x++){const i=y*W+x;if(!mask[i])continue;const o=(yo+x)*4,j=i*4,L=lab[i];
    let cr=col[j],cg=col[j+1],cb=col[j+2],ty=1,op=0,bump=0;
    if(L>=0){ty=ctype[L];op=copal[L];if((i&15)===0){const k2=((cr>>4)<<8)|((cg>>4)<<4)|(cb>>4);pal.set(k2,(pal.get(k2)||0)+1)}
      if(cclear[L]){cr=lerp(cr,248,.95);cg=lerp(cg,250,.95);cb=lerp(cb,247,.95)}
      const v=cclear[L]?1:vary[L];cr=Math.min(255,cr*v);cg=Math.min(255,cg*v);cb=Math.min(255,cb*v);
      if(ty===TY.JEWEL){const t=Math.min(1,dist[i]/Math.max(dmax[L],1));bump=Math.sqrt(1-(1-t)*(1-t))*255}
      tcount[ty]=(tcount[ty]||0)+1}
    G[o]=cr;G[o+1]=cg;G[o+2]=cb;G[o+3]=op*255;
    const ld=ln[j]/255,isI=irn&&irn[j]>127;
    S[o]=isI?255:ln[j];S[o+1]=sold[i];S[o+2]=bump;S[o+3]=ln[j+1];
    I[o]=ty;I[o+1]=feat[i];I[o+2]=L>=0?seedV[L]:0;I[o+3]=isI?255:0;
    let tf=1;if(ty===3||ty===9)tf=1-.6*op;else if(ty===7)tf=.6;else if(ty===8)tf=.9;
    tf*=(1-clamp(((isI?1:ld)-.2)*2.5,0,1))*(1-.92*ln[j+1]/255);
    const lr=lin[cr|0]*tf,lg=lin[cg|0]*tf,lb=lin[cb|0]*tf;LT[o]=toS[(lr*4095)|0];LT[o+1]=toS[(lg*4095)|0];LT[o+2]=toS[(lb*4095)|0];LT[o+3]=255;
    ar+=lr;ag+=lg;ab+=lb;am++}}
  const sw=[];[...pal.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k])=>{const c=[((k>>8)&15)*16+8,((k>>4)&15)*16+8,(k&15)*16+8];
    if(sw.length<8&&sw.every(s=>Math.hypot(s[0]-c[0],s[1]-c[1],s[2]-c[2])>56))sw.push(c)});
  const tot=Object.values(tcount).reduce((a,b)=>a+b,0)||1;
  const spots={};for(const hm of st.hall){if(hm.uv){spots[hm.f]=[hm.uv[0],A*(1-hm.uv[1])];continue}const p=hm.s||hm.r;const[u,t]=toCrop(st,p[0],p[1]);spots[hm.f]=[u,A*(1-t)]}
  const outline=m.outline.map(([u,t])=>[u,A*(1-t)]).reverse();
  return{W,H,A,G,S,I,LT,avg:[ar/am,ag/am,ab/am],palette:sw.map(c=>toHex(...c)),types:Object.entries(tcount).map(([t,n])=>[+t,n/tot]).sort((a,b)=>b[1]-a[1]),
    spots,outline,perimU:4*hw/W,hwPx:hw,pieces:nc,joints:blobs.length}}

const ASSET_V='202610261900';   // bump to make browsers fetch fresh window textures
let META=null; // windows/meta.json, written by tools/build_textures.py

// ---------------------------------------------------------------- the windows
// hallmark r = [x%, y%, rx%, ry%] ellipse on the source photograph; s = pin position when it differs
const LEADC=[.036,.036,.04];
const lightish=(c,s=.16,l=.62)=>c.s<s&&c.l>l;
const STYLES={
 gothic:{name:'Medieval & Gothic',era:'12th–15th century',crop:[.14,.032,.87,.99],width:1.35,vary:.05,came:[.03,.03,.033],cameSpec:.45,
  glassType:c=>[TY.ANT],
  env:{wall:'stone',floor:'flag',wallTint:[1,.97,.92],floorTint:[.9,.88,.84],sill:1.9,depth:.75,splay:.2,sillDrop:.32,frame:null,fill:[.016,.014,.012],room:[-5.5,5.5,10.5,16],view:{t:[0,4.2],d:9.2,y:1.7}},
  win:{title:'Notre-Dame de la Belle Verrière',maker:'Chartres workshop',date:'c. 1180, set in a surround of c. 1215–20',place:'Chartres Cathedral, France'},
  credit:{by:'Eusebius; upper half sharpened with a detail by Vassil',lic:'Public domain',url:'https://commons.wikimedia.org/wiki/File:Chartres_-_cath%C3%A9drale_-_ND_de_la_belle_verri%C3%A8re.JPG'},
  blurb:'The Virgin and Child at the centre survived the fire of 1194 and were reset a generation later inside new panels of angels and Gospel scenes. Its blue, a cobalt pot-metal glass, became known simply as Chartres blue.',
  facts:[['Glass','Mouth-blown pot-metal, flashed ruby, painted in grisaille'],['Came','Cast lead, wide and heavy'],['Support','Iron saddle bars across the lancet']],
  hall:[{f:1,t:'The enthroned Virgin',d:'The 12th-century core: the Virgin and Child in Chartres blue, framed by a ruby ground.',r:[50,31,12,13]},
   {f:2,t:'Censing angels',d:'Angels added around 1215 swing censers toward the Virgin, in ruby and violet against cobalt.',r:[26,37,8,15]},
   {f:3,t:'Narrative scenes',d:'The bottom registers tell the Temptation of Christ and the Wedding at Cana, read from the bottom up.',r:[50,82,33,15]},
   {f:14,t:'Saddle bars',d:'Horizontal iron bars set into the stone carry the weight of each panel.',s:[30,19.6]},
   {f:15,t:'Heavy cames',d:'Every small piece is held in lead; at a distance the leads become part of the drawing.',s:[64,58]}],
  proc:['The design is drawn full size on a whitewashed table, every lead line marked.','Pot-metal sheets are split with a hot iron and nibbled to shape with a grozing iron.',
   'Grisaille, ground glass and iron oxide, draws faces and folds and is fired onto each piece.','Cast lead cames, H-shaped in section, are fitted around every piece.',
   'Every joint is soldered and the panel cemented so it is rigid and weathertight.','Panels are wired to the iron saddle bars in the stone opening.']},
 victorian:{name:'Victorian',era:'1837–1901',crop:[.022,.03,.985,.972],width:1.14,vary:.03,came:LEADC,cameSpec:.6,
  glassType:c=>c.area<.0012&&c.round>.55&&c.s>.35?[TY.JEWEL]:c.s<.2&&c.l>.7?[TY.CATH]:[TY.OPAL,.4],
  env:{fill:[.05,.04,.032],wall:'wallpaper',floor:'wood',wallTint:[1,1,1],floorTint:[.62,.5,.44],sill:1.0,depth:.32,splay:.05,sillDrop:0,frame:{w:.07,d:.1,tint:[.32,.2,.14]},room:[-3.6,3.6,3.7,9],view:{t:[0,1.95],d:4.7,y:1.6}},
  win:{title:'Peonies Blown in the Wind',maker:'John La Farge',date:'c. 1880',place:'The Metropolitan Museum of Art, New York'},
  credit:{by:'The Metropolitan Museum of Art',lic:'CC0',url:'https://www.metmuseum.org/art/collection/search/5582'},
  blurb:'High Victorian taste at its richest: a flowering peony set inside layered borders of scrolls, scales and pressed glass jewels. La Farge, working in New York, patented opalescent glass in 1880 and shaded the flowers with the glass itself.',
  facts:[['Glass','Opalescent and streaky sheet, pressed jewels'],['Came','Lead, of varied width'],['Movement','Aesthetic Movement, Victorian era']],
  hall:[{f:1,t:'Floral centrepiece',d:'Peonies and leaves bending in the wind, the subject framed like a painting.',r:[47,55,17,15]},
   {f:2,t:'Jewelled border',d:'Round pressed-glass jewels stud the outer border and catch the light like cabochons.',r:[7,50,5,46]},
   {f:3,t:'Layered geometric frames',d:'Bands of scrolls, scales and gold fillets step inward to the picture.',r:[78,50,5,34]},
   {f:4,t:'Streaky opalescent sky',d:'Blue glass with built-in streaks stands in for a painted sky.',r:[50,27,14,6]},
   {f:15,t:'Lead lines',d:'Leads follow every petal and scale, varying in width.',s:[30,70]}],
  proc:['A watercolour design is scaled up to a full-size cartoon.','Opalescent sheets are chosen for their streaks; jewels are pressed in moulds.',
   'Little paint: the shading is in the glass.','Lead of varied width is fitted around every piece and jewel.','Joints are soldered and the panel cemented.','Set in a timber frame, the jewels throw points of colour into the room.']},
 nouveau:{name:'Art Nouveau',era:'c. 1890–1910',crop:[.004,.004,.982,.996],width:1.07,vary:.02,came:LEADC,cameSpec:.6,
  glassType:c=>[TY.OPAL,c.l>.75?.6:.45],
  env:{fill:[.045,.04,.032],wall:'plaster',floor:'wood',wallTint:[.5,.5,.38],floorTint:[.7,.58,.45],sill:1.25,depth:.32,splay:.05,sillDrop:0,frame:{w:.065,d:.1,tint:[.3,.2,.12]},paint:[.75,.72,.6],room:[-3.6,3.6,3.9,9],view:{t:[0,1.95],d:4.6,y:1.6}},
  win:{title:'Magnolias and Irises',maker:'Louis Comfort Tiffany / Tiffany Studios',date:'c. 1908',place:'The Metropolitan Museum of Art, New York'},
  credit:{by:'The Metropolitan Museum of Art',lic:'CC0',url:'https://commons.wikimedia.org/wiki/File:Magnolias_and_Irises_MET_DT280214.jpg'},
  blurb:'A memorial window that is really a landscape. Magnolias overhang a river valley at dusk while irises crowd the foreground. Nearly all the modelling is in Tiffany’s opalescent, streaky and folded “drapery” glass rather than in paint.',
  facts:[['Glass','Opalescent, streaky, mottled and drapery glass'],['Came','Fine lead and copper foil'],['Movement','American Art Nouveau']],
  hall:[{f:1,t:'Magnolia blossoms',d:'Each petal is a single piece of opalescent glass chosen for its own shading.',r:[55,13,30,11]},
   {f:2,t:'Irises',d:'The period’s favourite flower, in violet and blue with sword-shaped leaves.',r:[45,72,36,7]},
   {f:3,t:'River valley',d:'Hills and water fading into the distance, built only from glass colour.',r:[55,54,25,7]},
   {f:4,t:'Sunset sky',d:'Graded opalescent glass carries the sky from blue to apricot.',r:[42,35,26,6]},
   {f:15,t:'Organic lead lines',d:'Leads follow branches and stems; the line is part of the drawing.',s:[84,44]}],
  proc:['The cartoon is a drawing in its own right: lead lines are the stems and branches.','Opalescent sheets are chosen piece by piece for their streaks.',
   'Almost no paint; the gradients are in the glass.','Fine came and copper foil follow the curves.','Joints are soldered; foil seams become the line.','Installed, the opalescent glass glows even without direct sun.']},
 deco:{name:'Art Deco',era:'1925–1940s',crop:[.012,.004,.99,.996],width:1.0,vary:.02,came:[.3,.3,.31],cameSpec:1.1,
  glassType:c=>c.l<.3?[TY.ANT]:c.s<.2?[c.rnd<.35?TY.CATH:c.rnd<.6?TY.HAMM:c.rnd<.8?TY.FROST:TY.CLEAR,0,c.l>.55]:[TY.ANT],
  env:{fill:[.04,.04,.04],wall:'plaster',floor:'terrazzo',wallTint:[.93,.92,.89],floorTint:[.85,.85,.85],sill:.55,depth:.25,splay:0,sillDrop:0,frame:{w:.035,d:.07,tint:[.06,.06,.065]},paint:[.93,.92,.89],room:[-3.4,3.4,3.3,9],view:{t:[0,1.7],d:4.8,y:1.6}},
  win:{title:'Façade window of the Barillet studio (Athènes panel)',maker:'Louis Barillet',date:'1932',place:'15 square de Vergennes, Paris (now Musée Mendjisky)'},
  credit:{by:'Velvet',lic:'CC BY-SA 4.0',url:'https://commons.wikimedia.org/wiki/File:Paris_atelier_barillet_vitrail_athenes.jpg'},
  blurb:'Barillet built his studio as a manifesto of modern glass. No colour, no paint: the image is made from greys, blacks and dozens of industrial textured and reeded clear glasses, held in a grid of steel bars. Seen from inside, the lettering reads in reverse.',
  facts:[['Glass','Pressed, reeded and textured clear; grey and black'],['Came','Lead, with steel T-bars'],['Movement','Art Deco, Union des artistes modernes']],
  hall:[{f:1,t:'Industrial textured glass',d:'Reeded, pressed and hammered clear glasses replace colour with texture.',r:[80,60,12,9]},
   {f:2,t:'Geometric composition',d:'Arcs, rectangles and diagonals, ruled with compass and square.',r:[33,40,18,10]},
   {f:3,t:'Lettering',d:'“ATHÈNES”, one of the place names on the façade, reversed from this side.',r:[60,16.5,30,3]},
   {f:14,t:'Steel bars',d:'Strong horizontal bars, part of the graphic design as much as the structure.',s:[50,48]},
   {f:5,t:'Black and grey palette',d:'A monochrome range, the machine-age opposite of Gothic colour.',r:[22,86,14,8]}],
  proc:['A ruled drawing with compass and set-square.','Industrial textured glasses are cut to straight lines and arcs.','No paint.',
   'Came and steel bars hold the straight lines true.','Joints are soldered.','Set in the studio façade, the textures scatter light rather than colour it.']},
 mission:{name:'Mission & Craftsman',era:'c. 1895–1925',crop:[.055,.11,.958,.88],width:.62,vary:.02,came:[.05,.035,.024],cameSpec:.45,
  extras:['mission_left','mission_right'],
  glassType:c=>[TY.OPAL,.5],
  env:{fill:[.085,.08,.075],wall:'plaster',floor:'wood',wallTint:[.6,.65,.69],floorTint:[.85,.7,.5],sill:1.15,depth:.25,splay:0,sillDrop:0,frame:null,band:{n:3,gap:.15},bandPanes:['mission_left',null,'mission_right'],
    sash:[.5,.28,.14],surround:[.11,.065,.04],trim:[.42,.26,.14],room:[-3.6,3.6,3.0,9],view:{t:[0,1.5],d:3.7,y:1.45}},
  win:{title:'Casement windows from the Tichenor House',maker:'Charles and Henry Greene (Greene & Greene)',date:'1904–05',place:'Long Beach, California; now The Huntington'},
  credit:{by:'The Huntington Library, Art Museum and Botanical Gardens',lic:'Public domain',url:'https://commons.wikimedia.org/wiki/File:Greene_%26_Greene_-_Tichenor_casement_windows_-_HNT.jpg'},
  blurb:'Greene & Greene treated a window as joinery. Three oak casements, each split into three lights, sit in a heavy dark surround with a projecting head and sill. Streaky green and amber glass glows behind a climbing vine of dark leaded metal that wanders across all nine lights.',
  facts:[['Glass','Streaky opalescent green and amber'],['Came','Lead, with a cast vine overlay'],['Frame','Oak sashes in a dark oak surround']],
  hall:[{f:1,t:'Climbing vine',d:'One natural motif, drawn as dark lead branches across the panes.',r:[35,45,13,32]},
   {f:2,t:'Earth-toned streaky glass',d:'Green and amber opalescent glass, chosen for its warmth.',r:[60,28,12,12]},
   {f:16,t:'Oak sashes and surround',d:'Light oak casements inside a dark surround with a projecting head and a deep sill: the frame is part of the design.',s:[23,50]},
   {f:17,t:'Three casements',d:'The vine continues from one casement to the next, so the three read as one picture.',uv:[-.74,.45]},
   {f:15,t:'Sturdy came',d:'Plain lead holds large, simple pieces.',s:[72,20]}],
  proc:['A simple drawing: three lights and one vine.','Streaky green and amber sheets are cut in large, plain pieces.','No paint.',
   'Lead holds the pieces and the vine is built on top.','Joints are soldered and darkened to match the oak.','Set in the oak sash, the window belongs to the woodwork.']},
 prairie:{name:'Prairie',era:'c. 1900–1917',crop:[.046,.024,.955,.986],width:.82,vary:.01,came:[.42,.29,.11],cameSpec:1.3,
  glassType:c=>c.l>.74||(c.s<.18&&c.l>.6)?[TY.CLEAR,0,1]:c.s<.25&&c.l>.5?[TY.OPAL,.45]:[TY.IRID,.35],
  env:{fill:[.07,.06,.05],wall:'plaster',floor:'wood',wallTint:[.7,.6,.45],floorTint:[.8,.62,.45],sill:1.0,depth:.3,splay:0,sillDrop:0,frame:{w:.065,d:.07,tint:[.66,.42,.22]},trim:[.66,.42,.22],room:[-3.4,3.4,3.0,9],view:{t:[0,1.62],d:3.3,y:1.5}},
  win:{title:'“Tree of Life” window, Darwin D. Martin House',maker:'Frank Lloyd Wright',date:'1904',place:'Buffalo, New York; this example at Princeton University Art Museum'},
  credit:{by:'Daderot',lic:'Public domain',url:'https://commons.wikimedia.org/wiki/File:Tree_of_Life_window_for_the_Darwin_D._Martin_House,_by_Frank_Lloyd_Wright,_American,_1904,_glass,_brass_-_Princeton_University_Art_Museum_-_DSC06964.jpg'},
  blurb:'Wright called these light screens. Three abstract trees rise from a base of gold squares, drawn only with straight brass-plated cames, and most of the glass is clear so the garden stays in view.',
  facts:[['Glass','Clear, with iridised and opalescent accents'],['Came','Zinc electroplated with brass'],['Setting','Oak casement between amber side lights']],
  hall:[{f:1,t:'Abstracted trees',d:'Chevrons stacked on a spine: a tree reduced to straight lines.',r:[50,19,43,14]},
   {f:2,t:'Clear glass',d:'Most of the window is clear. Move around and look through it at the trees outside.',r:[50,58,40,14]},
   {f:3,t:'Iridised gold squares',d:'Square accents of iridised and gold glass anchor the base.',r:[50,87,38,5]},
   {f:15,t:'Brass-plated came',d:'Narrow bright cames turn the leading itself into the ornament.',s:[43,62]}],
  proc:['Wright drew the window as part of the house, abstracting a plant into straight lines.','Mostly clear glass, with small iridised pieces for accents.','No paint.',
   'Narrow zinc came, plated with brass, draws the composition in fine gold lines.','Joints are soldered and the brass kept bright.','Set in bands of casements, the screens frame the landscape.']},
 mackintosh:{name:'Mackintosh',era:'c. 1896–1910',crop:[.088,.03,.905,.918],width:.85,vary:.01,came:[.02,.02,.022],cameSpec:.5,
  glassType:c=>lightish(c,.12,.72)?[TY.OPAL,.55]:[TY.ANT],
  env:{fill:[.04,.04,.04],wall:'plaster',floor:'wood',wallTint:[.92,.91,.88],floorTint:[.4,.32,.27],sill:1.25,depth:.2,splay:0,sillDrop:0,frame:null,paint:[.95,.95,.93],door:{w:1.05,h:2.45},room:[-3.4,3.4,3.4,9],view:{t:[0,1.45],d:4.2,y:1.5}},
  win:{title:'Entrance hall glass, House for an Art Lover',maker:'Charles Rennie Mackintosh',date:'designed 1901, built 1989–96',place:'Bellahouston Park, Glasgow'},
  credit:{by:'Jean-Pierre Dalbéra',lic:'CC BY 2.0',url:'https://commons.wikimedia.org/wiki/File:Vitrail_du_hall_dentr%C3%A9e_(House_for_an_art_lover,_Glasgow)_(3809393032).jpg'},
  blurb:'Mackintosh drew the house for a 1901 competition and it was finally built in Glasgow in the 1990s from his drawings. The glass shows his vocabulary: white opal ground, long sweeping lead lines, one stylised rose and a few drops of colour.',
  facts:[['Glass','White opal, rose, violet and green'],['Came','Lead, blackened'],['Movement','Glasgow Style']],
  hall:[{f:1,t:'Glasgow Rose',d:'A rose reduced to a circle cut by a few curved leads.',r:[30,38,10,11]},
   {f:15,t:'Sweeping verticals',d:'Long, slightly converging lead lines give the panel its rise.',s:[57,62]},
   {f:3,t:'Green buds',d:'Small leaf shapes in green, the only other colour accents.',r:[80,20,8,7]},
   {f:4,t:'Violet drop',d:'A single violet bead weights the bottom of the design.',r:[72,87,4,4]},
   {f:5,t:'White opal ground',d:'Most of the panel is white. The empty space is deliberate.',r:[42,76,10,9]}],
  proc:['A spare drawing: long verticals, one rose, a few buds.','White opal makes the ground; small pieces of rose, violet and green are cut for the motifs.','Little or no paint.',
   'Dark lead draws long, sweeping lines.','Joints are soldered and the lead blackened to read crisply against white.','Set into a door screen in a white interior.']}
};
const ORDER=['gothic','victorian','nouveau','deco','mission','prairie','mackintosh'];
const STEPS=['Cartoon','Cutting','Painting','Leading','Soldering','In the light'];

// ---------------------------------------------------------------- shaders
const NOISE=`
float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
vec2 hash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x),mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*vnoise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,1.7);a*=.5;}return s/.97;}
float fbm3(vec2 p){float s=0.,a=.5;for(int i=0;i<3;i++){s+=a*vnoise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,1.7);a*=.5;}return s/.875;}
vec3 voro(vec2 p){vec2 i=floor(p),f=fract(p);float md=8.;vec2 mc=vec2(0.);for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(float(x),float(y));vec2 o=hash22(i+g);vec2 r=g+o-f;float d=dot(r,r);if(d<md){md=d;mc=i+g;}}return vec3(sqrt(md),hash12(mc),hash12(mc+7.31));}
`;
const WINPROJ=`
uniform sampler2D tLight; uniform vec4 uWin; uniform vec2 uBand; uniform float uGZ; uniform vec3 uSun; uniform vec3 uSunCol; uniform float uSunI; uniform float uInstall;
vec3 throughWindow(vec3 P, float lod0, float lodK){
  if(uSun.z>-0.01) return vec3(0.);
  float t=(uGZ-P.z)/uSun.z; if(t<=0.) return vec3(0.);
  vec2 h=P.xy+uSun.xy*t-uWin.xy;
  float i=floor(h.x/uBand.y); if(i<0.||i>=uBand.x) return vec3(0.);
  vec2 uv=vec2(h.x-i*uBand.y,h.y)/uWin.zw;
  if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.) return vec3(0.);
  return textureLod(tLight,uv,lod0+log2(max(1.,t*lodK))).rgb;
}`;
const VS_WORLD=`varying vec2 vUv; varying vec3 vW; varying vec3 vN;
void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;vN=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*w;}`;

const FS_GLASS=`
uniform sampler2D tGlass; uniform sampler2D tSurf; uniform sampler2D tInfo; uniform sampler2D tLight;
uniform vec2 uTex; uniform vec2 uSize; uniform float uLeadS;
uniform vec3 uSun; uniform vec3 uSunCol; uniform float uSunI; uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uLand;
uniform float uStage; uniform float uTime; uniform float uFeature; uniform float uHL;
uniform vec3 uCame; uniform float uCameSpec; uniform vec3 uIron; uniform vec3 uLamp; uniform vec3 uLampCol;
varying vec2 vUv; varying vec3 vW;
${NOISE}
// the world outside: a photographic panorama, blurred by how much the glass diffuses, tinted by the time of day
uniform sampler2D tPano; uniform float uPanoU; uniform float uPanoI;
vec3 outside(vec3 d, float blur){
  d=normalize(d);
  vec2 uv=vec2(fract(0.5+uPanoU+atan(d.x,-d.z)/6.28318),0.5+asin(clamp(d.y,-1.,1.))/3.14159);
  vec3 tint=uHor/max(dot(uHor,vec3(.333)),1e-3);
  vec3 sky=textureLod(tPano,uv,blur*9.).rgb*uPanoI*mix(vec3(1.),tint,0.6);
  float mu=max(dot(d,uSun),0.);
  sky+=uSunCol*uSunI*(pow(mu,mix(500.,6.,blur))*mix(1.2,0.3,blur)+pow(mu,8.)*0.06);
  sky+=uSunCol*uSunI*smoothstep(0.99985-blur*0.05,0.99995,mu)*(1.-blur)*30.;
  return sky;
}
vec3 diffuseIn(vec3 d){
  float sunOn=max(-uSun.z,0.);
  return mix(uHor,uZen,0.35)*0.9+uLand*0.25+uSunCol*uSunI*(0.07*sunOn+0.22*pow(max(dot(normalize(d),uSun),0.),2.5));
}
vec3 incoming(vec3 d,float df){ return mix(outside(d,df),diffuseIn(d),smoothstep(0.15,0.9,df)); }
vec3 roomEnv(vec3 R){ float up=R.y*0.5+0.5; float l=max(dot(R,uLamp),0.);
  return mix(vec3(0.008,0.007,0.006),vec3(0.03,0.026,0.022),up)+uLampCol*(pow(l,160.)*2.2+pow(l,10.)*0.04); }
float prof(vec4 s){ return max(pow(sin(clamp(s.r,0.,1.)*1.5708),0.45), s.g*1.12); }

void main(){
  vec4 info=texture(tInfo,vUv);
  float typ=floor(info.r*255.+0.5);
  if(typ<0.5) discard;
  float feat=floor(info.g*255.+0.5), seed=info.b, iron=step(0.5,info.a);
  vec4 gt=texture(tGlass,vUv); vec3 base=gt.rgb; float opal=gt.a;
  vec4 sf=texture(tSurf,vUv);
  vec4 sR=texture(tSurf,vUv+vec2(uTex.x,0.)), sL=texture(tSurf,vUv-vec2(uTex.x,0.)), sU=texture(tSurf,vUv+vec2(0.,uTex.y)), sD=texture(tSurf,vUv-vec2(0.,uTex.y));
  float leadL=sf.r, paint=sf.a;
  vec2 pm=vUv*uSize;
  vec3 V=normalize(vW-cameraPosition);
  float cutP=clamp(uStage,0.,1.), paintP=clamp(uStage-1.,0.,1.), leadP=clamp(uStage-2.,0.,1.), solP=clamp(uStage-3.,0.,1.), instP=clamp(uStage-4.,0.,1.);

  float ang=seed*43.7+0.3; mat2 Rm=mat2(cos(ang),sin(ang),-sin(ang),cos(ang));
  vec2 q=Rm*pm+seed*vec2(17.3,9.1);
  vec2 grad=vec2(0.); float diff=0., thick=1., o=0., bub=0., bubCore=0., sheen=0., grain=0.;
  float e=0.0015;
  if(typ<1.5){ // antique, mouth-blown
    vec2 sc=vec2(4.,1.6); float h0=fbm3(q*sc),hx=fbm3((q+vec2(e,0.))*sc),hy=fbm3((q+vec2(0.,e))*sc);
    grad=vec2(hx-h0,hy-h0)/e*0.006;
    thick=0.6+0.9*fbm(q*vec2(1.1,9.));
    diff=0.26;
    vec3 v=voro(q*vec2(26.,52.)); float on=step(v.y,0.08); float rad=0.12+0.22*v.z;
    bub=on*(1.-smoothstep(rad*0.7,rad,v.x)); bubCore=on*(1.-smoothstep(0.,rad*0.55,v.x));
  } else if(typ<2.5){ // rolled cathedral ripple
    float w=2.8*fbm3(q*vec2(5.,2.5)); float f=150.;
    grad=vec2(cos(q.x*f+w)*f*0.0009,0.);
    float h0=fbm3(q*28.),hx=fbm3((q+vec2(e,0.))*28.),hy=fbm3((q+vec2(0.,e))*28.);
    grad+=vec2(hx-h0,hy-h0)/e*0.0016;
    thick=0.88+0.25*fbm3(q*3.); diff=0.5;
  } else if(typ<3.5 || typ>8.5){ // opalescent / iridised
    vec2 w=q+0.5*vec2(fbm3(q*2.2),fbm3(q*2.2+4.7));
    float wisp=fbm(w*vec2(1.6,5.5));
    o=clamp(opal*(0.35+1.1*smoothstep(0.25,0.85,wisp)),0.,1.);
    thick=0.75+0.6*wisp;
    float h0=fbm3(q*14.),hx=fbm3((q+vec2(e,0.))*14.),hy=fbm3((q+vec2(0.,e))*14.);
    grad=vec2(hx-h0,hy-h0)/e*0.004;
    diff=0.85;
    base=mix(base,mix(base,vec3(0.95,0.93,0.86),0.55),smoothstep(0.55,0.9,wisp)*opal);
    if(typ>8.5) sheen=1.;
  } else if(typ<4.5){ // clear, slightly wavy
    vec2 sc=vec2(1.2,3.5); float h0=fbm3(q*sc),hx=fbm3((q+vec2(e,0.))*sc),hy=fbm3((q+vec2(0.,e))*sc);
    grad=vec2(hx-h0,hy-h0)/e*0.0035; diff=0.0;
    vec3 v=voro(q*vec2(18.,36.)); float on=step(v.y,0.025); float rad=0.1+0.2*v.z;
    bub=on*(1.-smoothstep(rad*0.7,rad,v.x)); bubCore=on*(1.-smoothstep(0.,rad*0.55,v.x));
  } else if(typ<6.5){ diff=typ<5.5?0.0:0.04;
  } else if(typ<7.5){ grain=vnoise(pm*1400.); diff=0.97;
  } else { // hammered / granite
    float ee=e*0.3; vec3 v0=voro(q*48.),vx=voro((q+vec2(ee,0.))*48.),vy=voro((q+vec2(0.,ee))*48.);
    grad=vec2(vx.x*vx.x-v0.x*v0.x,vy.x*vy.x-v0.x*v0.x)/ee*0.0025; diff=0.6; thick=0.9+0.2*fbm3(q*2.);
  }
  grad=grad*Rm;
  float tm=uSize.x*uTex.x;
  vec2 bg=vec2(sR.b-sL.b,sU.b-sD.b)/(2.*tm);
  grad+=bg*((typ>5.5&&typ<6.5)?0.006:0.0035);

  float kR=(typ>4.5&&typ<6.5)?1.3:1.;
  vec3 dO=normalize(V+vec3(grad*kR,0.));
  vec3 inc;
  if(diff<0.1){ vec3 dR=normalize(V+vec3(grad*kR*1.07,0.)), dB=normalize(V+vec3(grad*kR*0.93,0.));
    inc=vec3(incoming(dR,diff).r,incoming(dO,diff).g,incoming(dB,diff).b);
  } else inc=incoming(dO,diff);
  vec3 T=pow(max(base,vec3(0.0005)),vec3(mix(1.,thick,0.45)));
  float ref=dot(diffuseIn(vec3(0.,0.15,-1.)),vec3(0.2126,0.7152,0.0722));
  vec3 glass=T*inc*(1.25/max(ref,0.05));
  if(o>0.){ vec3 sc=base*diffuseIn(V)*(1.05/max(ref,0.05)); glass=mix(glass,sc,o); }
  if(typ>6.5&&typ<7.5) glass=base*diffuseIn(V)*(1.1/max(ref,0.05))*(0.94+0.12*grain);
  glass*=1.+bubCore*0.9-bub*0.45;
  vec3 N=normalize(vec3(-grad*0.6,1.));
  float cosT=max(dot(-V,N),0.);
  vec3 env=roomEnv(reflect(V,N));
  float F=0.04+0.96*pow(1.-cosT,5.);
  if(sheen>0.){ vec3 film=0.5+0.5*cos(6.2831*(vec3(0.,0.33,0.67)+cosT*1.6+fbm3(q*3.)*0.8)); glass+=film*(0.05+F*0.4)*dot(uHor,vec3(0.33)); }
  float pnt=clamp(paint*paintP*(0.92+0.16*vnoise(pm*320.)),0.,1.);
  glass=glass*(1.-0.97*pnt)+vec3(0.012,0.009,0.006)*pnt;
  glass+=env*F*(1.-pnt*0.5);

  // cartoon on the bench, visible before pieces are laid and through the gaps
  vec3 paper=vec3(0.86,0.82,0.74)*(0.88+0.12*vnoise(pm*150.))*(0.4+0.6*vnoise(pm*9.)*0.2+0.5);
  float cl=smoothstep(0.3,0.5,leadL);
  vec3 cart=mix(paper*mix(vec3(1.),base*0.9+0.25,0.3),paper*0.05,cl);
  float gap=smoothstep(0.62,0.75,leadL);
  vec3 col;
  if(seed>0.001) col=(seed<=cutP*1.0001)?glass:cart;
  else col=mix(cart,glass,step(0.999,cutP)*(1.-gap));
  col*=1.-0.35*smoothstep(0.12,0.3,leadL)*solP;

  // came
  float hR=prof(sR),hL=prof(sL),hU=prof(sU),hD=prof(sD);
  vec3 Nl=normalize(vec3(-(hR-hL)*uLeadS,-(hU-hD)*uLeadS,1.));
  float leadM=smoothstep(0.06,0.85,leadL);
  float sweep=smoothstep(vUv.y-0.04,vUv.y,leadP*1.05);
  float lm=leadM*(iron>0.5?instP:sweep);
  vec3 alb=uCame*(0.85+0.3*vnoise(pm*90.)); float spc=uCameSpec;
  if(iron>0.5){ alb=uIron*(0.6+0.8*fbm3(pm*vec2(90.,12.)))+uIron*vec3(0.6,0.3,0.1)*smoothstep(0.5,0.8,vnoise(pm*30.)); spc=0.25; }
  float sol=smoothstep(0.05,0.35,sf.g)*solP*(1.-iron);
  alb=mix(alb,vec3(0.16,0.16,0.17),sol*0.6); spc=mix(spc,0.8,sol);
  vec3 Rl=reflect(V,Nl);
  float ndl=max(dot(Nl,uLamp),0.);
  vec3 glow=textureLod(tLight,vUv,4.5).rgb*dot(uHor,vec3(0.4))*0.22*(1.-Nl.z*0.7);
  vec3 leadC=alb*(uLampCol*0.12*ndl+vec3(0.012,0.011,0.01)+glow)+roomEnv(Rl)*spc*0.3*(0.04+0.96*pow(1.-max(dot(-V,Nl),0.),5.)+0.15);
  col=mix(col,leadC,lm);

  if(uFeature>0.5 && uHL>0.001){
    float m=step(abs(feat-uFeature),0.5);
    bool isLead=abs(uFeature-15.)<0.5, isIron=abs(uFeature-14.)<0.5, isSym=abs(uFeature-13.)<0.5;
    if(isLead) m=lm*(1.-iron);
    if(isIron) m=lm*iron;
    if(isSym) m=step(vUv.x,0.5);
    float Lm=dot(col,vec3(0.3,0.59,0.11));
    vec3 dim=mix(vec3(Lm),col,0.3)*0.18;
    vec3 hi=col*(1.+0.22*sin(uTime*3.))+((isLead||isIron)?vec3(0.9,0.55,0.2)*0.4*m:vec3(0.));
    col=mix(col,mix(dim,hi,m),uHL);
    if(isSym) col+=vec3(1.,0.8,0.5)*uHL*(1.-smoothstep(0.0005,0.003,abs(vUv.x-0.5)))*3.;
  }
  gl_FragColor=vec4(col,1.);
}`;

const FS_ROOM=`
uniform sampler2D map; uniform float rep; uniform vec3 tint; uniform float uRefl; uniform float uGloss; uniform float uRot; uniform float uBump;
uniform vec3 uLamp; uniform vec3 uLampCol;
uniform float uSkyB; uniform vec3 uFill; uniform vec3 uKeyDir; uniform float uKeyK; uniform float uBlurK; uniform float uWinArea; uniform vec3 uWinAvg; uniform vec3 uWinC;
varying vec2 vUv; varying vec3 vW; varying vec3 vN;
${NOISE}
${WINPROJ}
void main(){
  vec3 N=normalize(vN); if(!gl_FrontFacing) N=-N;
  vec3 P=vW; vec3 aN=abs(N);
  vec2 uv; vec3 Tu,Tv;
  if(aN.y>0.6){uv=P.xz;Tu=vec3(1,0,0);Tv=vec3(0,0,1);} else if(aN.x>0.6){uv=P.zy;Tu=vec3(0,0,1);Tv=vec3(0,1,0);} else {uv=P.xy;Tu=vec3(1,0,0);Tv=vec3(0,1,0);}
  if(uRot>0.5){uv=uv.yx;vec3 t=Tu;Tu=Tv;Tv=t;}            // grain runs along the member
  vec2 tuv=uv/rep; vec3 tex=texture(map,tuv).rgb;
  if(uBump>0.){float e=1./1024.,h0=dot(tex,vec3(.333)),hu=dot(texture(map,tuv+vec2(e,0.)).rgb,vec3(.333)),hv=dot(texture(map,tuv+vec2(0.,e)).rgb,vec3(.333));
    N=normalize(N-(Tu*(hu-h0)+Tv*(hv-h0))*uBump*6.);}
  vec3 alb=tex*tint*(0.88+0.24*vnoise(uv*0.9));
  float ndl=dot(N,uSun);
  vec3 Ld=ndl>0.?throughWindow(P,0.,uBlurK)*ndl*uSunCol*uSunI*uInstall*2.6:vec3(0.);
  vec3 toW=uWinC-P; float d2=dot(toW,toW); vec3 wd=toW*inversesqrt(d2);
  float ff=max(dot(N,wd),0.)*max(-wd.z,0.);
  vec3 amb=uWinAvg*uSkyB*uWinArea*ff/(d2+0.8)*0.22;
  vec3 bounce=(uWinAvg*uSunCol*uSunI*uInstall*0.012+uWinAvg*uSkyB*0.008)*(0.7+0.3*N.y)/(1.+0.08*d2)+uFill*mix(0.75+0.25*N.y,0.3+1.1*max(dot(N,uKeyDir),0.)+0.15*N.y,uKeyK)*uSkyB;
  vec3 col=alb*(Ld+amb+bounce);
  vec3 V=normalize(P-cameraPosition);
  float refl=uRefl;
  if(uGloss>0.){ float g=uGloss*(0.7+0.6*dot(tex,vec3(.333)));   // varnish pools less in the open grain
    float fr=0.04+0.96*pow(1.-max(dot(-V,N),0.),5.);
    float ex=mix(30.,140.,uGloss);
    if(ndl>0.) col+=Ld/max(ndl,0.05)*pow(max(dot(N,normalize(uSun-V)),0.),ex)*g*0.8;
    col+=uLampCol*uFill*uSkyB*(pow(max(dot(N,normalize(uLamp-V)),0.),ex)*(1.+3.*uGloss)+fr*0.25)*g;
    refl=max(refl,g*0.18); }
  if(refl>0.){
    vec3 R=reflect(V,N);
    if(R.z<-0.01){ float t=(uGZ-P.z)/R.z; vec2 wuv=(P.xy+R.xy*t-uWin.xy)/uWin.zw;
      if(wuv.x>0.&&wuv.y>0.&&wuv.x<1.&&wuv.y<1.){ float fr=0.04+0.96*pow(1.-max(dot(-V,N),0.),5.);
        col+=textureLod(tLight,wuv,3.+log2(1.+t)*1.5).rgb*uSkyB*fr*refl*(0.6+0.8*vnoise(uv*6.)); } }
  }
  gl_FragColor=vec4(col,1.);
}`;

const FS_RAYS=`
uniform float uTime; uniform float uRayI; uniform float uWallZ;
varying vec2 vUv; varying vec3 vW; varying vec3 vN;
${NOISE}
${WINPROJ}
void main(){
  vec3 ro=cameraPosition; vec3 rd=vW-ro; float tMax=length(rd); rd/=tMax;
  float j=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))));
  const int STEPS=48; float dt=tMax/float(STEPS); vec3 acc=vec3(0.);
  for(int i=0;i<STEPS;i++){ vec3 p=ro+rd*(float(i)+j)*dt; if(p.z<uWallZ) continue;
    vec3 c=throughWindow(p,3.,0.6);
    float dens=0.55+0.9*vnoise(p.xy*1.3+vec2(uTime*0.03,p.z*0.7));
    acc+=c*dens; }
  float mu=dot(rd,uSun), g=0.55;
  float ph=(1.-g*g)/pow(1.+g*g-2.*g*mu,1.5)/12.566;
  gl_FragColor=vec4(acc*dt*ph*uRayI*uSunCol*uSunI*uInstall,1.);
}`;

const VS_DUST=`
attribute float aSeed; uniform float uTime; uniform float uPx; uniform float uWallZ; varying vec3 vC; varying float vA;
${WINPROJ}
void main(){
  vec3 p=position+vec3(sin(uTime*0.07+aSeed*40.)*0.25,sin(uTime*0.05+aSeed*13.)*0.2,cos(uTime*0.06+aSeed*7.)*0.25);
  vC=p.z>uWallZ?throughWindow(p,3.,0.)*uSunCol*uSunI*uInstall:vec3(0.);
  vec4 mv=viewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv;
  gl_PointSize=max(1.,(0.5+aSeed)*uPx/max(-mv.z,0.1));
  vA=0.55+0.45*sin(uTime*0.9+aSeed*50.);
}`;
const FS_DUST=`varying vec3 vC; varying float vA;
void main(){ vec2 d=gl_PointCoord-0.5; float a=smoothstep(0.5,0.0,length(d)); gl_FragColor=vec4(vC*vA*0.6,a); }`;

const ToneShader={uniforms:{tDiffuse:{value:null},uExp:{value:1.5}},
  vertexShader:`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`uniform sampler2D tDiffuse; uniform float uExp; varying vec2 vUv;
  void main(){ vec3 x=texture2D(tDiffuse,vUv).rgb*uExp; float m=max(max(x.r,x.g),x.b); float Wp=10.;
    float mm=m*(1.+m/(Wp*Wp))/(1.+m); vec3 y=x*(mm/max(m,1e-5));
    y=mix(y,vec3(mm),smoothstep(1.5,12.,m)*0.75);
    vec2 d=vUv-0.5; y*=1.-dot(d,d)*0.6;
    gl_FragColor=vec4(clamp(y,0.,1.),1.); }`};

// ---------------------------------------------------------------- renderer & scene
const $=s=>document.querySelector(s);
const canvas=$('#gl');
const renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.toneMapping=THREE.NoToneMapping;
const scene=new THREE.Scene();scene.background=new THREE.Color(0);
const camera=new THREE.PerspectiveCamera(42,1,.03,60);
const controls=new OrbitControls(camera,canvas);
controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=.35;controls.maxDistance=24;
controls.minAzimuthAngle=-1.15;controls.maxAzimuthAngle=1.15;controls.minPolarAngle=.45;controls.maxPolarAngle=1.95;controls.screenSpacePanning=true;
const rt=new THREE.WebGLRenderTarget(4,4,{type:THREE.HalfFloatType,samples:4});
const composer=new EffectComposer(renderer,rt);
composer.addPass(new RenderPass(scene,camera));
const bloom=new UnrealBloomPass(new THREE.Vector2(4,4),.35,.5,1.25);composer.addPass(bloom);
const tone=new ShaderPass(ToneShader);composer.addPass(tone);composer.addPass(new OutputPass());

const v3=(a,b,c)=>new THREE.Vector3(a,b,c);
const U={tLight:{value:null},uWin:{value:new THREE.Vector4()},uBand:{value:new THREE.Vector2(1,1)},uGZ:{value:-.03},uSun:{value:v3(0,0,-1)},uSunCol:{value:v3(1,1,1)},uSunI:{value:3.5},
  uInstall:{value:1},uZen:{value:v3()},uHor:{value:v3()},uLand:{value:v3()},uSkyB:{value:1},uTime:{value:0},uWallZ:{value:.3},
  uWinAvg:{value:v3()},uFill:{value:v3(.004,.0036,.0032)},uKeyDir:{value:v3(-.45,.55,.7).normalize()},uKeyK:{value:0},uWinC:{value:v3()},uWinArea:{value:1},uBlurK:{value:8}};
const GU={...U,tGlass:{value:null},tSurf:{value:null},tInfo:{value:null},uTex:{value:new THREE.Vector2()},uSize:{value:new THREE.Vector2()},uLeadS:{value:4},
  uStage:{value:5},tPano:{value:null},uPanoU:{value:-.14},uPanoI:{value:1.6},uIron:{value:v3(.035,.03,.028)},uFeature:{value:0},uHL:{value:0},uCame:{value:v3()},uCameSpec:{value:.5},
  uLamp:{value:v3(-.35,.45,1).normalize()},uLampCol:{value:v3(1,.78,.55)}};
const glassMat=new THREE.ShaderMaterial({uniforms:GU,vertexShader:VS_WORLD,fragmentShader:FS_GLASS});
const glass=new THREE.Mesh(new THREE.PlaneGeometry(1,1),glassMat);scene.add(glass);
const rayMat=new THREE.ShaderMaterial({uniforms:{...U,uRayI:{value:.11}},vertexShader:VS_WORLD,fragmentShader:FS_RAYS,side:THREE.BackSide,transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending});
const rays=new THREE.Mesh(new THREE.BoxGeometry(12,7.5,16),rayMat);rays.renderOrder=10;scene.add(rays);
const dustMat=new THREE.ShaderMaterial({uniforms:{...U,uPx:{value:3}},vertexShader:VS_DUST,fragmentShader:FS_DUST,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
let dust=null;

function roomMat(tex,rep,tint,refl=0,o={}){return new THREE.ShaderMaterial({uniforms:{...U,map:{value:tex},rep:{value:rep},tint:{value:v3(...tint)},uRefl:{value:refl},
    uGloss:{value:o.gloss||0},uRot:{value:o.rot?1:0},uBump:{value:o.bump||0},uLamp:GU.uLamp,uLampCol:GU.uLampCol},vertexShader:VS_WORLD,fragmentShader:FS_ROOM,side:THREE.DoubleSide})}

// ---------------------------------------------------------------- procedural room textures
const TEXC={};
function canvasTex(key,size,draw){if(TEXC[key])return TEXC[key];const c=document.createElement('canvas');c.width=c.height=size;const x=c.getContext('2d');draw(x,size,mulberry(key.length*7919+size));
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return TEXC[key]=t}
function speck(x,S,r,n,a){for(let i=0;i<n;i++){const v=r()<.5?r()*60:200+r()*55;x.fillStyle=`rgba(${v|0},${v|0},${v|0},${a*r()})`;const s=1+r()*2;x.fillRect(r()*S,r()*S,s,s)}}
function blot(x,S,r,n,a){for(let i=0;i<n;i++){const cx=r()*S,cy=r()*S,rad=S*(.03+r()*.15),c=r()<.5?'0,0,0':'255,255,255';
  for(const ox of[-S,0,S])for(const oy of[-S,0,S]){const g=x.createRadialGradient(cx+ox,cy+oy,0,cx+ox,cy+oy,rad);g.addColorStop(0,`rgba(${c},${a})`);g.addColorStop(1,`rgba(${c},0)`);x.fillStyle=g;x.fillRect(cx+ox-rad,cy+oy-rad,rad*2,rad*2)}}}
function blocks(x,S,r,rows,minW,maxW,gap,base){x.fillStyle=base;x.fillRect(0,0,S,S);const rh=S/rows;
  for(let j=0;j<rows;j++){let px=-r()*S*.3;while(px<S){const w=S*(minW+r()*(maxW-minW)),v=120+r()*45;x.fillStyle=`rgb(${v|0},${v*.96|0},${v*.9|0})`;
    for(const o of[0,-S,S])x.fillRect(px+o+gap,j*rh+gap,w-2*gap,rh-2*gap);px+=w}}}
const TEX={
  stone:()=>canvasTex('stone',1024,(x,S,r)=>{blocks(x,S,r,7,.18,.4,3,'#4e4a44');blot(x,S,r,220,.06);speck(x,S,r,40000,.25)}),
  flag:()=>canvasTex('flag',1024,(x,S,r)=>{blocks(x,S,r,3,.3,.55,4,'#2e2b28');blot(x,S,r,200,.07);speck(x,S,r,30000,.2)}),
  plaster:()=>canvasTex('plaster',1024,(x,S,r)=>{x.fillStyle='#cfcac0';x.fillRect(0,0,S,S);blot(x,S,r,260,.025);speck(x,S,r,30000,.06)}),
  wood:()=>canvasTex('wood',1024,(x,S,r)=>{const n=12,ph=S/n;for(let i=0;i<n;i++){const b=[150+r()*30,98+r()*22,60+r()*16];x.fillStyle=`rgb(${b.map(v=>v|0)})`;x.fillRect(0,i*ph,S,ph);
    for(let k=0;k<70;k++){const y=i*ph+r()*ph,a=r()*.12,am=2+r()*4,fr=.004+r()*.01,ph0=r()*9;x.strokeStyle=`rgba(40,22,10,${a})`;x.lineWidth=.6+r()*1.4;x.beginPath();
      for(let X=0;X<=S;X+=16){const Y=y+Math.sin(X*fr+ph0)*am;X?x.lineTo(X,Y):x.moveTo(X,Y)}x.stroke()}
    x.fillStyle='rgba(20,10,4,.6)';x.fillRect(0,i*ph,S,2);const jx=r()*S;x.fillRect(jx,i*ph,2,ph)}}),
  wallpaper:()=>canvasTex('wallpaper',512,(x,S,r)=>{x.fillStyle='#4a1a1c';x.fillRect(0,0,S,S);
    const motif=(cx,cy,k)=>{x.save();x.translate(cx,cy);x.scale(k,k);x.fillStyle='rgba(196,140,80,.32)';
      for(const sx of[-1,1]){x.beginPath();x.moveTo(0,-110);x.bezierCurveTo(sx*70,-80,sx*90,-10,sx*30,20);x.bezierCurveTo(sx*80,40,sx*50,100,0,120);x.lineTo(0,-110);x.fill()}
      x.fillStyle='rgba(110,40,36,.9)';x.beginPath();x.ellipse(0,0,18,40,0,0,TAU);x.fill();x.restore()};
    for(const[cx,cy]of[[0,0],[S,0],[0,S],[S,S],[S/2,S/2]])motif(cx,cy,1.05);speck(x,S,r,6000,.08)}),
  terrazzo:()=>canvasTex('terrazzo',1024,(x,S,r)=>{x.fillStyle='#bdb8ae';x.fillRect(0,0,S,S);for(let i=0;i<9000;i++){const v=r();x.fillStyle=v<.3?'#2a2826':v<.6?'#8c857a':v<.8?'#e8e4dc':'#a2785a';x.beginPath();x.ellipse(r()*S,r()*S,1+r()*5,1+r()*4,r()*3,0,TAU);x.fill()}
    x.strokeStyle='rgba(40,38,34,.5)';x.lineWidth=2;for(let k=0;k<=4;k++){x.beginPath();x.moveTo(k*S/4,0);x.lineTo(k*S/4,S);x.moveTo(0,k*S/4);x.lineTo(S,k*S/4);x.stroke()}}),
  oak:()=>canvasTex('oak',1024,(x,S,r)=>{x.fillStyle='#cdb08a';x.fillRect(0,0,S,S);
    for(let k=0;k<420;k++){const y=r()*S,am=1+r()*5,fr=.002+r()*.006,p=r()*9,d=r();x.strokeStyle=`rgba(${70+d*40|0},${40+d*25|0},${15+d*10|0},${.05+r()*.16})`;x.lineWidth=.6+r()*2.2;x.beginPath();
      for(let X=-16;X<=S+16;X+=16){const Y=y+Math.sin(X*fr+p)*am;X>-16?x.lineTo(X,Y):x.moveTo(X,Y)}x.stroke()}
    for(let k=0;k<700;k++){const cx=r()*S,cy=r()*S,w=6+r()*34,h=1.5+r()*4;x.fillStyle=`rgba(240,215,170,${.08+r()*.2})`;x.beginPath();x.ellipse(cx,cy,w,h,(r()-.5)*.25,0,TAU);x.fill()}
    blot(x,S,r,80,.04)}),
  grain:()=>canvasTex('grain',512,(x,S,r)=>{x.fillStyle='#c9c4bc';x.fillRect(0,0,S,S);for(let k=0;k<260;k++){const y=r()*S,am=1+r()*3,fr=.01+r()*.02,p=r()*9;x.strokeStyle=`rgba(30,20,10,${r()*.15})`;x.lineWidth=.5+r();x.beginPath();
    for(let X=0;X<=S;X+=8){const Y=y+Math.sin(X*fr+p)*am;X?x.lineTo(X,Y):x.moveTo(X,Y)}x.stroke()}})
};

// ---------------------------------------------------------------- window + room build
let roomGroup=null,RES=null,ST=null,KEY='gothic',texs=[],paneTex=[];
const HP=new URLSearchParams(location.hash.slice(1));if(STYLES[HP.get('style')])KEY=HP.get('style');
function makeTex(data,W,H,srgb,nearest,mip){const t=new THREE.DataTexture(data,W,H,THREE.RGBAFormat,THREE.UnsignedByteType);t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;
  t.magFilter=nearest?THREE.NearestFilter:THREE.LinearFilter;t.minFilter=nearest?THREE.NearestFilter:(mip?THREE.LinearMipmapLinearFilter:THREE.LinearFilter);t.generateMipmaps=!!mip;
  t.anisotropy=nearest?1:renderer.capabilities.getMaxAnisotropy();t.needsUpdate=true;return t}
const resTex=res=>[makeTex(res.G,res.W,res.H,true,false,true),makeTex(res.S,res.W,res.H,false,false,true),makeTex(res.I,res.W,res.H,false,true,false),makeTex(res.LT,res.W,res.H,true,false,true)];
// main window geometry in metres: sill height, width, height, left edge
const winBox=(st,res)=>{const E=st.env,Wm=st.width;return{x0:-Wm/2,y0:E.sill,W:Wm,H:Wm*res.A}};
function applyWindow(st,res){
  texs.forEach(t=>t.dispose());texs=resTex(res);
  [GU.tGlass.value,GU.tSurf.value,GU.tInfo.value,U.tLight.value]=texs;
  const E=st.env,{x0,y0,W:Wm,H:Hm}=winBox(st,res);
  glass.geometry.dispose();glass.geometry=new THREE.PlaneGeometry(Wm,Hm);glass.position.set(0,y0+Hm/2,U.uGZ.value);
  GU.uTex.value.set(1/res.W,1/res.H);GU.uSize.value.set(Wm,Hm);GU.uCame.value.set(...st.came);GU.uCameSpec.value=st.cameSpec;GU.uIron.value.set(...(st.iron||[.035,.03,.028]));
  GU.uLeadS.value=Math.max(res.hwPx,1.5)*.9;
  const band=E.band||{n:1,gap:0},bw=band.n*Wm+(band.n-1)*band.gap;
  U.uWin.value.set(-bw/2,y0,Wm,Hm);U.uBand.value.set(band.n,Wm+band.gap);
  U.uWallZ.value=E.depth;U.uWinC.value.set(0,y0+Hm/2,0);U.uWinAvg.value.set(...res.avg);U.uWinArea.value=bw*Hm;
  U.uBlurK.value=res.W/Wm*.012;U.uFill.value.set(...(E.fill||[.005,.0045,.004]));U.uKeyK.value=E.key||0;
  const lum=.2126*res.avg[0]+.7152*res.avg[1]+.0722*res.avg[2];rayMat.uniforms.uRayI.value=.13*clamp(.07/Math.max(lum,1e-3),.1,1)*(E.rays??1)}

// a glass pane with its own textures (context windows)
function paneMat(res,w,h){const t=resTex(res);paneTex.push(...t);
  return new THREE.ShaderMaterial({uniforms:{...GU,tGlass:{value:t[0]},tSurf:{value:t[1]},tInfo:{value:t[2]},tLight:{value:t[3]},uTex:{value:new THREE.Vector2(1/res.W,1/res.H)},
    uSize:{value:new THREE.Vector2(w,h)},uLeadS:{value:Math.max(res.hwPx,1.5)*.9},uFeature:{value:0},uHL:{value:0}},vertexShader:VS_WORLD,fragmentShader:FS_GLASS})}

function solidPane(rgb,type){const W=96,H=384,N=W*H,G=new Uint8Array(N*4),S=new Uint8Array(N*4),I=new Uint8Array(N*4),LT=new Uint8Array(N*4),r=mulberry(7);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const o=(y*W+x)*4,edge=x<2||y<2||x>W-3||y>H-3,v=.94+.12*r();
    G[o]=rgb[0]*v;G[o+1]=rgb[1]*v;G[o+2]=rgb[2]*v;S[o]=edge?255:0;I[o]=type;I[o+2]=edge?0:120;LT[o]=rgb[0]*.8;LT[o+1]=rgb[1]*.8;LT[o+2]=rgb[2]*.8;LT[o+3]=255}
  return{W,H,G,S,I,LT,hwPx:1.5}}
// ---- small geometry helpers
const v2=(x,y)=>new THREE.Vector2(x,y);
const box=(g,m,w,h,d,x,y,z)=>{const me=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);me.position.set(x,y,z);g.add(me);return me};
const cyl=(g,m,r0,r1,h,x,y,z,seg=20)=>{const me=new THREE.Mesh(new THREE.CylinderGeometry(r1,r0,h,seg),m);me.position.set(x,y+h/2,z);g.add(me);return me};
const tube=(g,m,pts,r)=>{const c=new THREE.CatmullRomCurve3(pts.map(p=>v3(...p)));g.add(new THREE.Mesh(new THREE.TubeGeometry(c,Math.max(16,pts.length*3),r,10,false),m))};
function pointedArch(cx,ys,hw,R,n=20){const r=R*hw,o=[];   // left spring -> apex -> right spring; R in half-widths
  for(let i=0;i<=n;i++){const x=cx-hw+i/n*hw;o.push([x,ys+Math.sqrt(Math.max(r*r-(x-(cx-hw+r))**2,0))])}
  for(let i=n-1;i>=0;i--){const x=cx+hw-i/n*hw;o.push([x,ys+Math.sqrt(Math.max(r*r-(x-(cx+hw-r))**2,0))])}return o}
function ring(g,m,outer,inner,depth,z,bevel=.004){const s=new THREE.Shape(outer.map(p=>v2(p[0],p[1])));s.holes.push(new THREE.Path(inner.map(p=>v2(p[0],p[1]))));
  const me=new THREE.Mesh(new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,curveSegments:4}),m);me.position.z=z;g.add(me);return me}
function wallWithHoles(g,m,x0,x1,h,z,holes){const s=new THREE.Shape([v2(x0,0),v2(x1,0),v2(x1,h),v2(x0,h)]);holes.forEach(hh=>s.holes.push(new THREE.Path(hh.map(p=>v2(p[0],p[1])))));
  const me=new THREE.Mesh(new THREE.ShapeGeometry(s),m);me.position.z=z;g.add(me)}
// splayed reveal between the glass plane (z0) and the wall face (z1), normals split at sharp corners
function reveal(g,m,rv0,rv1,z0,z1){const n=rv0.length,pos=[],nor=[],fn=[];
  const xs=rv0.map(p=>p[0]),ys=rv0.map(p=>p[1]),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
  for(let i=0;i<n;i++){const j=(i+1)%n,a=v3(rv0[i][0],rv0[i][1],z0),b=v3(rv0[j][0],rv0[j][1],z0),c=v3(rv1[i][0],rv1[i][1],z1);
    const nn=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).normalize();if(nn.x*(cx-a.x)+nn.y*(cy-a.y)<0)nn.negate();fn.push(nn)}
  for(let i=0;i<n;i++){const j=(i+1)%n,np=(i-1+n)%n;
    const ni=fn[np].dot(fn[i])>.75?fn[np].clone().add(fn[i]).normalize():fn[i],nJ=fn[j].dot(fn[i])>.75?fn[j].clone().add(fn[i]).normalize():fn[i];
    pos.push(rv0[i][0],rv0[i][1],z0,rv0[j][0],rv0[j][1],z0,rv1[i][0],rv1[i][1],z1,rv0[j][0],rv0[j][1],z0,rv1[j][0],rv1[j][1],z1,rv1[i][0],rv1[i][1],z1);
    [ni,nJ,ni,nJ,nJ,ni].forEach(v=>nor.push(v.x,v.y,v.z))}
  const rg=new THREE.BufferGeometry();rg.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));rg.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));
  rg.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(pos.length/3*2),2));g.add(new THREE.Mesh(rg,m))}
// an opening in the wall: outline (world, CCW) -> reveal + optional frame; returns the hole cut in the wall face
function opening(g,o){const{outl,bottom,depth,splay=0,sillDrop=0,frame,inset,wallM,frameM}=o;
  const edge=offsetPoly(outl,-inset),fw=frame?frame.w:0;
  const rv0=frame?offsetPoly(outl,fw):edge;
  const rv1=offsetPoly(outl,fw+splay).map((p,i)=>bottom&&bottom[i]?[p[0],p[1]-sillDrop]:p);
  reveal(g,wallM,rv0,rv1,0,depth);
  if(frame)ring(g,frameM,offsetPoly(outl,fw),edge,frame.d,-.055,.005);
  return rv1}
const worldOutline=(res,x0,y0,w,h)=>{const d=densify(res.outline,.02);return{outl:d.map(([u,v])=>[x0+u*w,y0+v/res.A*h]),bottom:d.map(p=>p[1]<1e-6)}};
const bboxOf=pts=>{const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);return{x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys)}};

// ---- materials for the settings
const M={};
function mats(st){const E=st.env;const T=(k,rep,tint,refl)=>roomMat(TEX[k](),rep,tint,refl);
  return{wall:T(E.wall,E.wall==='wallpaper'?1.2:2,E.wallTint),floor:T(E.floor,E.floor==='flag'?3:E.floor==='terrazzo'?2:2.5,E.floorTint,E.floor==='flag'?.1:.16),
    dark:T(E.wall==='wallpaper'?'plaster':E.wall,2,E.wallTint.map(v=>v*.3)),stone:T('stone',2,[1,.97,.92]),
    wood:roomMat(TEX.oak(),.9,(E.frame&&E.frame.tint)||[.5,.34,.2],0,{gloss:.22,bump:.5}),woodV:roomMat(TEX.oak(),.9,(E.frame&&E.frame.tint)||[.5,.34,.2],0,{gloss:.22,bump:.5,rot:1}),
    trim:roomMat(TEX.oak(),.9,E.trim||[.5,.34,.2],0,{gloss:.2,bump:.5}),trimV:roomMat(TEX.oak(),.9,E.trim||[.5,.34,.2],0,{gloss:.2,bump:.5,rot:1}),paint:T('plaster',2,E.paint||[.9,.9,.88]),
    black:T('plaster',2,[.06,.06,.065]),ebony:T('grain',.3,[.05,.035,.025])}}

// ---- per-style architecture around the main opening. Each returns extra wall holes.
const SETTINGS={
 // Chartres ambulatory: twin lancets and an oculus under a wall arch, colonnettes, blind arcade, vault ribs
 gothic(g,m,ctx){const{wb,E,rv1,extras}=ctx,Dz=E.depth,z=Dz+.005,holes=[];
   const nW=1.3,gap=.66,nx0=wb.x0+wb.W+gap;
   const n=extras.gothic_n,o=extras.gothic_o;
   if(n){const wo=worldOutline(n,nx0,wb.y0,nW,wb.H);holes.push(opening(g,{...wo,depth:Dz,splay:E.splay,sillDrop:E.sillDrop,inset:.006,wallM:m.wall}));
     const me=new THREE.Mesh(new THREE.PlaneGeometry(nW,wb.H),paneMat(n,nW,wb.H));me.position.set(nx0+nW/2,wb.y0+wb.H/2,U.uGZ.value);g.add(me)}
   const ocx=(wb.x0+wb.W+nx0)/2,ocy=wb.y0+wb.H+.85,od=.82;
   if(o){const wo=worldOutline(o,ocx-od/2,ocy-od/2,od,od);holes.push(opening(g,{...wo,depth:Dz,splay:.2,inset:.006,wallM:m.wall}));
     const me=new THREE.Mesh(new THREE.PlaneGeometry(od,od),paneMat(o,od,od));me.position.set(ocx,ocy,U.uGZ.value);g.add(me)}
   // colonnettes, capitals and roll mouldings around each lancet
   const lancets=[rv1].concat(holes.length?[holes[0]]:[]);
   for(const r of lancets){const b=bboxOf(r),spring=b.y1-(b.x1-b.x0)*.62,cx=(b.x0+b.x1)/2;
     for(const x of[b.x0-.07,b.x1+.07]){cyl(g,m.stone,.06,.06,spring-b.y0,x,b.y0,z+.06);cyl(g,m.stone,.07,.12,.16,x,spring,z+.06);box(g,m.stone,.28,.06,.28,x,spring+.19,z+.06);box(g,m.stone,.2,.12,.2,x,b.y0-.06,z+.06)}
     const arch=offsetPoly(r,.07).filter(p=>p[1]>spring+.05).sort((a,b2)=>Math.atan2(b2[1]-spring,b2[0]-cx)-Math.atan2(a[1]-spring,a[0]-cx));
     if(arch.length>4)tube(g,m.stone,arch.map(p=>[p[0],p[1],z+.05]),.055)}
   // wall arch (formeret) over the bay, shafts to the floor, ribs into the vault
   const fx0=wb.x0-.95,fx1=wb.x0+wb.W+.95,fcx=(fx0+fx1)/2,fs=wb.y0+wb.H-.9;
   tube(g,m.stone,pointedArch(fcx,fs,(fx1-fx0)/2,1.3).map(p=>[p[0],p[1],z+.09]),.1);
   for(const x of[fx0,fx1]){cyl(g,m.stone,.12,.12,fs,x,0,z+.12);cyl(g,m.stone,.13,.2,.25,x,fs-.25,z+.12)}
   for(const x of[fx0,fx1])for(const s of[-1,1]){const pts=[];for(let i=0;i<=12;i++){const t=i/12;pts.push([x+s*t*2.2,fs+Math.sin(t*Math.PI/2)*3.1,z+.12+t*4.2])}tube(g,m.stone,pts,.09)}
   // string course, stone bench and blind arcade below the windows
   const sc=wb.y0-E.sillDrop-.08;box(g,m.stone,E.room[1]-E.room[0],.12,.14,(E.room[0]+E.room[1])/2,sc,z+.07);
   box(g,m.stone,E.room[1]-E.room[0],.45,.38,(E.room[0]+E.room[1])/2,.225,z+.19);
   for(let x=E.room[0]+.6;x<E.room[1]-.4;x+=.78){cyl(g,m.stone,.035,.035,sc-.95-.45,x,.45,z+.04);
     tube(g,m.stone,pointedArch(x+.39,sc-.95+.02,.39,1.25,10).map(p=>[p[0],p[1],z+.035]),.035)}
   return holes},
 // High Victorian parlour: wallpaper above a panelled dado, moulded casing with a cornice head
 victorian(g,m,ctx){const{wb,E,rv1}=ctx,z=E.depth,R=E.room,cx=0;const b=bboxOf(rv1),cw=.13;
   dado(g,m,E,z,.95,.7);
   ring(g,m.wood,offsetPoly(rv1,cw),rv1,.04,z,.008);
   box(g,m.wood,b.x1-b.x0+2*cw+.16,.14,.1,cx,b.y1+cw+.07,z+.05);box(g,m.wood,b.x1-b.x0+2*cw+.24,.04,.13,cx,b.y1+cw+.16,z+.065);
   box(g,m.wood,b.x1-b.x0+2*cw+.1,.045,.16,cx,b.y0-.02,z+.08);
   box(g,m.wood,R[1]-R[0],.05,.04,0,3.2,z+.02);box(g,m.paint,R[1]-R[0],.16,.16,0,E.room[2]-.08,z+.08);return[]},
 // Gilded Age hall: tall oak wainscot, casing with pilasters and an entablature
 nouveau(g,m,ctx){const{wb,E,rv1}=ctx,z=E.depth;const b=bboxOf(rv1),cw=.1;
   dado(g,m,E,z,1.15,.85);
   ring(g,m.wood,offsetPoly(rv1,cw),rv1,.035,z,.006);
   for(const x of[b.x0-cw-.09,b.x1+cw+.09]){box(g,m.wood,.14,b.y1-b.y0+2*cw,.06,x,(b.y0+b.y1)/2,z+.03);box(g,m.wood,.2,.08,.09,x,b.y0-cw-.04,z+.045);box(g,m.wood,.2,.1,.09,x,b.y1+cw+.05,z+.045)}
   box(g,m.wood,b.x1-b.x0+2*cw+.5,.22,.08,0,b.y1+cw+.21,z+.04);box(g,m.wood,b.x1-b.x0+2*cw+.6,.05,.14,0,b.y1+cw+.345,z+.07);
   box(g,m.wood,b.x1-b.x0+2*cw+.4,.05,.18,0,b.y0-cw-.02,z+.09);
   box(g,m.paint,E.room[1]-E.room[0],.18,.18,0,E.room[2]-.09,z+.09);return[]},
 // Barillet's studio: white walls, the panel in a steel window wall running floor to ceiling
 deco(g,m,ctx){const{wb,E,rv1}=ctx,z=E.depth,H=E.room[2];const b=bboxOf(rv1);
   for(const x of[b.x0-.03,b.x1+.03]){box(g,m.black,.05,H,.08,x,H/2,z+.04)}
   for(const y of[b.y0-.03,b.y1+.03,.06])box(g,m.black,b.x1-b.x0+.11,.05,.08,0,y,z+.04);
   box(g,m.black,E.room[1]-E.room[0],.1,.02,0,.05,z+.01);
   for(const x of[-2.6,2.6])box(g,m.paint,.5,H,.25,x,H/2,z+.125);return[]},
 // Greene & Greene: board-and-batten wainscot, frieze rail at head height, pegged casing, ceiling beams
 mission(g,m,ctx){const{wb,E,rv1}=ctx,z=E.depth,R=E.room,band=E.band;const b=bboxOf(rv1);
   const O=(t,rot)=>roomMat(TEX.oak(),.8,t,0,{gloss:.5,bump:.3,rot}),sash=O(E.sash),sashV=O(E.sash,1),dark=O(E.surround),darkV=O(E.surround,1);
   const per=wb.W+band.gap,bw=band.n*wb.W+(band.n-1)*band.gap,x0=-bw/2,y0=wb.y0,H=wb.H,st=.05,br=.12;
   const keys=E.bandPanes.map(k=>k||KEY);
   keys.forEach((k,i)=>{const gx=x0+i*per,cx=gx+wb.W/2,bars=META[k].bars||[];
     box(g,sashV,st,H+st+br,.05,gx-st/2,y0+(H+st-br)/2,-.02);box(g,sashV,st,H+st+br,.05,gx+wb.W+st/2,y0+(H+st-br)/2,-.02);
     box(g,sash,wb.W,st,.05,cx,y0+H+st/2,-.02);box(g,sash,wb.W,br,.05,cx,y0-br/2,-.02);
     for(const[b0,b1]of bars)box(g,sashV,(b1-b0)*wb.W+.004,H,.045,gx+(b0+b1)/2*wb.W,y0+H/2,-.02)});
   for(let i=1;i<band.n;i++)box(g,darkV,band.gap-2*st+.002,H+st+br,.07,x0+i*per-band.gap/2,y0+(H+st-br)/2,-.01);
   const ox0=x0-st,ox1=x0+bw+st,top=y0+H+st,bot=y0-br,W2=ox1-ox0,pz=z*.5;
   for(const x of[ox0-.07,ox1+.07])box(g,darkV,.14,top-bot+.02,z+.06,x,(top+bot)/2,pz);
   box(g,dark,W2+.28,.15,z+.12,0,top+.075,pz+.03);box(g,dark,W2+.4,.035,z+.2,0,top+.17,pz+.07);
   box(g,dark,W2+.36,.2,z+.16,0,bot-.1,pz+.05);
   box(g,m.trim,R[1]-R[0],.9,.02,0,.45,z+.01);for(let x=R[0]+.15;x<R[1];x+=.32)box(g,m.trim,.06,.9,.035,x,.45,z+.028);
   box(g,m.trim,R[1]-R[0],.05,.1,0,.92,z+.05);
   for(let x=R[0]+.6;x<R[1];x+=1.3)box(g,m.trim,.16,.22,R[3],x,R[2]-.11,z+R[3]/2);return[]},
 // Martin House, as installed: an oak casement between narrow amber side lights, deep sill, dentilled head
 prairie(g,m,ctx){const{wb,E,rv1}=ctx,z=E.depth,R=E.room;const b=bboxOf(rv1),cw=.09,holes=[];
   const H=b.y1-b.y0,sw=.24,cx=b.x1+cw+.1+sw/2;
   ring(g,m.wood,offsetPoly(rv1,cw),rv1,.035,z,.006);
   for(const sd of[-1,1]){const x=sd*cx,o=[[x-sw/2,b.y0],[x+sw/2,b.y0],[x+sw/2,b.y1],[x-sw/2,b.y1]];
     holes.push(opening(g,{outl:densify(o,.05),depth:z,frame:{w:.04,d:.06},inset:0,wallM:m.wood,frameM:m.wood}));
     const me=new THREE.Mesh(new THREE.PlaneGeometry(sw,H),paneMat(solidPane([196,142,58],TY.HAMM),sw,H));me.position.set(x,(b.y0+b.y1)/2,U.uGZ.value);g.add(me);
     ring(g,m.wood,offsetPoly(densify(o,.05),.06),densify(o,.05),.035,z,.006)}
   const W2=2*(cx+sw/2+.08),top=b.y1+cw;
   for(const x of[-(cx-sw/2-.05),cx-sw/2-.05])box(g,m.woodV,.1,H+2*cw,.02,x,(b.y0+b.y1)/2,z+.01);
   box(g,m.trim,W2,.2,.03,0,top+.1,z+.015);
   for(let x=-W2/2+.02;x<W2/2;x+=.034)box(g,m.trim,.017,.022,.025,x,top+.235,z+.02);
   box(g,m.trim,W2+.06,.04,.07,0,top+.27,z+.035);box(g,m.trim,W2+.06,.12,.03,0,top+.35,z+.015);
   box(g,m.wood,W2+.1,.05,.42,0,b.y0-cw-.025,z+.17);
   box(g,m.trimV,W2,b.y0-cw-.05,.02,0,(b.y0-cw-.05)/2,z+.01);
   for(let x=-W2/2+.1;x<W2/2;x+=.4)box(g,m.trimV,.07,b.y0-cw-.05,.035,x,(b.y0-cw-.05)/2,z+.025);
   for(const[y,h]of[[R[2]-.35,.06]])box(g,m.trim,R[1]-R[0],h,.03,0,y,z+.015);
   return holes},
 // House for an Art Lover: the glass is the top of a dark entrance door in a white hall
 mackintosh(g,m,ctx){const{wb,E,door,glassEdge}=ctx,z=E.depth;
   const s=new THREE.Shape([v2(door.x0,0),v2(door.x1,0),v2(door.x1,door.y1),v2(door.x0,door.y1)]);s.holes.push(new THREE.Path(glassEdge.map(p=>v2(p[0],p[1]))));
   const me=new THREE.Mesh(new THREE.ExtrudeGeometry(s,{depth:.055,bevelEnabled:true,bevelThickness:.005,bevelSize:.005,bevelSegments:2}),m.black);me.position.z=-.06;g.add(me);
   box(g,m.black,door.x1-door.x0-.24,.9,.02,(door.x0+door.x1)/2,.65,.005);
   for(const x of[door.x0-.06,door.x1+.06])box(g,m.paint,.12,door.y1+.12,.05,x,(door.y1+.12)/2,z+.025);
   box(g,m.paint,door.x1-door.x0+.24,.12,.05,(door.x0+door.x1)/2,door.y1+.06,z+.025);
   box(g,m.black,E.room[1]-E.room[0],.12,.02,0,.06,z+.01);
   for(const x of[-1.9,1.9]){box(g,m.black,.08,2.9,.08,x,1.45,z+.04);box(g,m.black,.5,.05,.12,x,2.92,z+.06)}return[]}
};
function dado(g,m,E,z,top,pw){const R=E.room;box(g,m.wood,R[1]-R[0],top,.02,0,top/2,z+.01);
  for(const y of[.06,top-.06])box(g,m.wood,R[1]-R[0],.09,.035,0,y,z+.028);
  for(let x=R[0]+.1;x<R[1];x+=pw)box(g,m.wood,.08,top-.12,.035,x,top/2,z+.028);
  box(g,m.wood,R[1]-R[0],.05,.07,0,top+.01,z+.04)}

function buildRoom(st,res,extras){
  if(roomGroup){scene.remove(roomGroup);roomGroup.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material&&o.material!==dustMat&&o.material!==glassMat)o.material.dispose()})}
  paneTex.forEach(t=>t.dispose());paneTex=[];
  roomGroup=new THREE.Group();scene.add(roomGroup);
  const E=st.env,R=E.room,Dz=E.depth,wb=winBox(st,res),m=mats(st);
  const inset=res.perimU*wb.W*.18,band=E.band;
  let main,glassEdge,door;
  if(band){const bw=band.n*wb.W+(band.n-1)*band.gap,x0=-bw/2,q=E.sash?[.05,.12,.05]:[0,0,0],
      outl=densify([[x0-q[0],wb.y0-q[1]],[x0+bw+q[0],wb.y0-q[1]],[x0+bw+q[0],wb.y0+wb.H+q[2]],[x0-q[0],wb.y0+wb.H+q[2]]],.05);
    main=opening(roomGroup,{outl,depth:Dz,splay:E.splay,frame:E.frame,inset,wallM:E.surround?roomMat(TEX.oak(),.8,E.surround,0,{gloss:.5,bump:.3,rot:1}):m.wall,frameM:m.wood});
    for(let i=0;i<band.n;i++){const x=x0+i*(wb.W+band.gap)+wb.W/2;if(Math.abs(x)<1e-6)continue;const k=E.bandPanes&&E.bandPanes[i];
      const me=new THREE.Mesh(glass.geometry,k&&extras[k]?paneMat(extras[k],wb.W,wb.H):glassMat);me.position.set(x,glass.position.y,glass.position.z);roomGroup.add(me)}}
  else if(E.door){const{outl}=worldOutline(res,wb.x0,wb.y0,wb.W,wb.H);glassEdge=offsetPoly(outl,-inset);
    door={x0:-E.door.w/2,x1:E.door.w/2,y1:E.door.h};
    main=opening(roomGroup,{outl:densify([[door.x0,0],[door.x1,0],[door.x1,door.y1],[door.x0,door.y1]],.05),depth:Dz,inset:0,wallM:m.paint})}
  else if(E.compose){main=null}
  else{const wo=worldOutline(res,wb.x0,wb.y0,wb.W,wb.H);main=opening(roomGroup,{...wo,depth:Dz,splay:E.splay,sillDrop:E.sillDrop,frame:E.frame,inset,wallM:m.wall,frameM:m.wood})}
  const holes=SETTINGS[KEY](roomGroup,m,{wb,E,rv1:main,extras,door,glassEdge});
  wallWithHoles(roomGroup,m.wall,R[0],R[1],R[2],Dz,[main,...holes].filter(Boolean));
  const add=(g,mm)=>{const me=new THREE.Mesh(g,mm);roomGroup.add(me);return me};
  const W=R[1]-R[0],cx=(R[0]+R[1])/2,L=R[3];
  const fl=new THREE.PlaneGeometry(W,L);fl.rotateX(-Math.PI/2);fl.translate(cx,0,Dz+L/2);add(fl,m.floor);
  const ce=new THREE.PlaneGeometry(W,L);ce.rotateX(Math.PI/2);ce.translate(cx,R[2],Dz+L/2);add(ce,m.dark);
  for(const[x,sd]of[[R[0],1],[R[1],-1]]){const w=new THREE.PlaneGeometry(L,R[2]);w.rotateY(sd*Math.PI/2);w.translate(x,R[2]/2,Dz+L/2);add(w,m.wall)}
  const bk=new THREE.PlaneGeometry(W,R[2]);bk.rotateY(Math.PI);bk.translate(cx,R[2]/2,Dz+L);add(bk,m.dark);
  rays.geometry.dispose();rays.geometry=new THREE.BoxGeometry(W,R[2],L);rays.position.set(cx,R[2]/2,Dz+L/2);
  if(!dust){const N=1600,p=new Float32Array(N*3),s=new Float32Array(N),r=mulberry(5);for(let i=0;i<N;i++){p[i*3]=(r()-.5)*7;p[i*3+1]=.05+r()*5.5;p[i*3+2]=r()*8;s[i]=r()}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('aSeed',new THREE.BufferAttribute(s,1));dust=new THREE.Points(g,dustMat);dust.frustumCulled=false;scene.add(dust)}
  dust.position.z=Dz+.1}

// ---------------------------------------------------------------- daylight
function setTod(t){const s=Math.sin(Math.PI*t),el=(6+46*s)*Math.PI/180,az=(-55+110*t)*Math.PI/180;
  U.uSun.value.set(Math.sin(az)*Math.cos(el),Math.sin(el),-Math.cos(az)*Math.cos(el));
  const warm=Math.pow(1-s,1.4),mix3=(a,b,k)=>a.map((v,i)=>lerp(v,b[i],k));
  U.uSunCol.value.set(...mix3([1,.95,.88],[1,.6,.3],warm));U.uSunI.value=2.2+2.2*s;
  const sk=.9+.8*s;U.uSkyB.value=sk;GU.uPanoI.value=1.7*sk;
  U.uZen.value.set(...mix3([.28,.45,.85],[.32,.32,.5],warm).map(v=>v*sk));U.uHor.value.set(...mix3([.85,.9,.98],[1.15,.75,.5],warm).map(v=>v*sk));
  U.uLand.value.set(...mix3([.1,.15,.07],[.12,.1,.06],warm).map(v=>v*sk*1.4));
  $('#todv').textContent=t<.3?'Morning':t<.7?'Midday':'Evening'}

// ---------------------------------------------------------------- UI
const stepsEl=$('#steps');STEPS.forEach((s,i)=>{const li=document.createElement('li');li.innerHTML=`<button data-s="${i}"><i></i>${s}</button>`;stepsEl.appendChild(li)});
const navEl=$('#styles');ORDER.forEach(k=>{const b=document.createElement('button');b.role='tab';b.dataset.k=k;b.innerHTML=`<span class="nm">${STYLES[k].name}</span><span class="dt">${STYLES[k].era}</span>`;navEl.appendChild(b)});
let stage=5,stageTarget=5,playing=false,playT=0,hlTarget=0,feature=0,fly=null,pins=[];
function updatePanel(st,res){
  navEl.querySelectorAll('button').forEach(b=>b.setAttribute('aria-selected',b.dataset.k===KEY));
  $('#era').textContent=st.era;$('#sname').textContent=st.name;$('#blurb').textContent=st.blurb;
  $('#facts').innerHTML=st.facts.map(([a,b])=>`<dt>${a}</dt><dd>${b}</dd>`).join('');
  $('#swatches').innerHTML=res.palette.map(h=>`<div class="sw"><i style="background:${h}"></i><span>${h.slice(1)}</span></div>`).join('');
  $('#gtypes').textContent=res.types.filter(t=>t[1]>.004).map(([t,f])=>`${TYNAME[t]} ${Math.round(f*100)||'<1'}%`).join(' · ')+` — ${res.pieces} pieces, ${res.joints} soldered joints`;
  $('#hallmarks').innerHTML=st.hall.map((h,i)=>`<li><button data-i="${i}" aria-pressed="false"><span class="num">${i+1}</span><span><b>${h.t}</b><span>${h.d}</span></span></button></li>`).join('');
  const w=st.win,c=st.credit;$('#srcimg').src=`windows/${KEY}_src.jpg`;$('#srcimg').alt='Photograph of '+w.title;
  $('#wtitle').textContent=w.title;$('#wmeta').textContent=`${w.maker}, ${w.date}. ${w.place}.`;
  $('#credit').innerHTML=`Photo: ${c.by}, ${c.lic}.`+(c.url?` <a href="${c.url}" target="_blank" rel="noopener">Source</a>`:'')+(c.lic.includes('SA')?'. Textures derived from it share the same licence.':'')}
function spotWorld(f){const s=RES.spots[f]||[.5,RES.A*.5],E=ST.env;return v3(-ST.width/2+s[0]*ST.width,ST._mapY?ST._mapY(s[1]):E.sill+s[1]*ST.width,f>=16?.05:U.uGZ.value+.01)}
function placeMarkers(){const m=$('#markers');m.innerHTML='';pins=ST.hall.map((h,i)=>{const b=document.createElement('button');b.className='pin';b.innerHTML=`${i+1}<span class="tip">${h.t}</span>`;
  b.setAttribute('aria-label',h.t);b.onclick=()=>selectHall(i);m.appendChild(b);return{el:b,pos:spotWorld(h.f)}})}
function homeView(){const E=ST.env,v=E.view;return{pos:v3(v.t[0]+v.d*.18,v.y,E.depth+v.d),target:v3(v.t[0],v.t[1],0)}}
function flyTo(v,dur=1.3){fly={p0:camera.position.clone(),t0:controls.target.clone(),p1:v.pos,t1:v.target,t:0,dur}}
function selectHall(i){const h=ST.hall[i],same=feature===i+1;
  document.querySelectorAll('#hallmarks button').forEach((b,k)=>b.setAttribute('aria-pressed',!same&&k===i));pins.forEach((p,k)=>p.el.classList.toggle('on',!same&&k===i));
  if(same){feature=0;hlTarget=0;flyTo(homeView());return}
  feature=i+1;stageTarget=5;playing=false;
  if(h.f>=16){hlTarget=0}else{GU.uFeature.value=h.f;hlTarget=1}
  const p=spotWorld(h.f),dist=h.f===13||h.f===15||h.f===14?2.6:1.9;flyTo({pos:p.clone().add(v3(.35,-.15,dist+ST.env.depth)),target:p})}
$('#hallmarks').addEventListener('click',e=>{const b=e.target.closest('button');if(b)selectHall(+b.dataset.i)});
navEl.addEventListener('click',e=>{const b=e.target.closest('button');if(b&&b.dataset.k!==KEY){KEY=b.dataset.k;history.replaceState(null,'','#style='+KEY);load(true)}});
$('#tod').oninput=e=>setTod(+e.target.value);
$('#beams').onclick=e=>{const on=e.currentTarget.getAttribute('aria-pressed')!=='true';e.currentTarget.setAttribute('aria-pressed',on);rays.visible=on;if(dust)dust.visible=on};
$('#overview').onclick=()=>{feature=0;hlTarget=0;document.querySelectorAll('#hallmarks button').forEach(b=>b.setAttribute('aria-pressed',false));flyTo(homeView())};
stepsEl.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;playing=false;stageTarget=+b.dataset.s;hlTarget=0});
$('#play').onclick=()=>{playing=!playing;if(playing){playT=0;stage=0;stageTarget=0;hlTarget=0;feature=0}};
function updateSteps(){const cur=Math.min(5,Math.ceil(stage-.02));stepsEl.querySelectorAll('li').forEach((li,i)=>{li.classList.toggle('done',i<cur||(i===cur&&stage>4.98));li.classList.toggle('now',i===cur)});
  $('#caption').textContent=(stage>4.98&&!playing)?'':ST.proc[cur];$('#play span').textContent=playing?'Pause':'Watch it made'}

async function load(resetCam){
  $('#loading').hidden=false;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  $('#loading').textContent='Leading up '+STYLES[KEY].win.title+'…';
  if(!GU.tPano.value){const t=await new THREE.TextureLoader().loadAsync('windows/outside.jpg?v='+ASSET_V);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=THREE.RepeatWrapping;
    t.minFilter=THREE.LinearMipmapLinearFilter;t.anisotropy=8;GU.tPano.value=t}
  try{ST=STYLES[KEY];RES=await fromPhoto(KEY,ST);const extras={};
    for(const k of ST.extras||[])extras[k]=await fromPhoto(k,{glassType:ST.glassType,vary:ST.vary,hall:[],crop:[0,0,1,1]});
    applyWindow(ST,RES);buildRoom(ST,RES,extras);updatePanel(ST,RES);placeMarkers();feature=0;hlTarget=0;GU.uHL.value=0;if(HP.has('stage')){stage=stageTarget=+HP.get('stage');HP.delete('stage')}
    if(resetCam||!camera.userData.ok){const h=homeView();if(HP.get('near')){h.pos.copy(h.target).add(v3(.3,-.3,1.6+ST.env.depth))}camera.position.copy(h.pos);controls.target.copy(h.target);camera.userData.ok=1}else flyTo(homeView(),.9);
  }catch(err){$('#err').textContent=String(err.stack||err)}
  $('#loading').hidden=true}

function resize(){const w=innerWidth,h=innerHeight;renderer.setSize(w,h,false);composer.setSize(w,h);camera.aspect=w/h;
  if(FILM)camera.clearViewOffset();else if(w>820)camera.setViewOffset(w,h,-(344+32)/2,0,w,h);else camera.setViewOffset(w,h,0,h*.2,w,h);camera.updateProjectionMatrix();
  dustMat.uniforms.uPx.value=h*renderer.getPixelRatio()/(2*Math.tan(camera.fov*Math.PI/360))*.006}
addEventListener('resize',resize);

const clock=new THREE.Clock(),tmp=new THREE.Vector3(),reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
function frame(){const dt=Math.min(clock.getDelta(),.05);U.uTime.value+=reduce?0:dt;
  if(playing){playT+=dt;const seg=4.2,k=Math.floor(playT/seg),f=playT%seg;stage=Math.min(5,k+(f<1?0:Math.min(1,(f-1)/2.6)));
    if(k>=5){playing=false;stage=5;stageTarget=5}}
  else stage+=(stageTarget-stage)*Math.min(1,dt*3);
  GU.uStage.value=stage;U.uInstall.value=.12+.88*clamp(stage-4,0,1);
  GU.uHL.value+=(hlTarget-GU.uHL.value)*Math.min(1,dt*4);if(hlTarget===0&&GU.uHL.value<.01)GU.uFeature.value=0;
  if(fly){fly.t+=dt/fly.dur;const e=fly.t>=1?1:1-Math.pow(1-fly.t,3);camera.position.lerpVectors(fly.p0,fly.p1,e);controls.target.lerpVectors(fly.t0,fly.t1,e);if(fly.t>=1)fly=null}
  controls.update();
  if(ST){const Dz=ST.env.depth;const R=ST.env.room;camera.position.x=clamp(camera.position.x,R[0]+.3,R[1]-.3);camera.position.y=clamp(camera.position.y,.25,R[2]-.2);camera.position.z=clamp(camera.position.z,Dz+.2,Dz+R[3]-.3);
    controls.target.x=clamp(controls.target.x,R[0]+.5,R[1]-.5);controls.target.y=clamp(controls.target.y,.3,R[2]-.3);controls.target.z=clamp(controls.target.z,-.1,Dz+2)}
  const show=stage>4.95&&!playing,w=innerWidth,h=innerHeight;
  for(const p of pins){tmp.copy(p.pos).project(camera);const vis=show&&tmp.z<1&&Math.abs(tmp.x)<1.05&&Math.abs(tmp.y)<1.05;p.el.style.opacity=vis?1:0;p.el.style.pointerEvents=vis?'auto':'none';
    p.el.style.transform=`translate(${(tmp.x*.5+.5)*w}px,${(-tmp.y*.5+.5)*h}px)`}
  if(ST)updateSteps();
  composer.render();requestAnimationFrame(frame)}
// ---------------------------------------------------------------- film mode (#film): a 15 s vertical reel, frame by frame
// Frames are POSTed to /frame?i=N (see tools/record_film.py); the reel is deterministic, not real time.
async function film(){
  document.body.classList.add('film');renderer.setPixelRatio(1);
  const FW=1080,FH=1920;renderer.setSize(FW,FH,false);composer.setSize(FW,FH);camera.aspect=FW/FH;camera.clearViewOffset();camera.updateProjectionMatrix();
  dustMat.uniforms.uPx.value=FH/(2*Math.tan(camera.fov*Math.PI/360))*.006;removeEventListener('resize',resize);
  const FPS=30,TOTAL=15*FPS,keys=ORDER,per=TOTAL/keys.length,fade=7,out=document.createElement('canvas');
  out.width=canvas.width;out.height=canvas.height;const ox=out.getContext('2d');
  await document.fonts.ready;
  const send=(i)=>new Promise(r=>out.toBlob(b=>fetch('/frame?i='+i,{method:'POST',body:b}).then(r),'image/png'));
  const ease=t=>t*t*(3-2*t);
  let i=0;
  for(const[si,k]of keys.entries()){
    KEY=k;await load(true);stage=stageTarget=5;GU.uStage.value=5;U.uInstall.value=1;feature=0;GU.uHL.value=0;
    pins.forEach(p=>p.el.style.opacity=0);
    const E=ST.env,b=bboxOf(densify(RES.outline,.05).map(([u,v])=>[-ST.width/2+u*ST.width,(ST._mapY?ST._mapY(v):E.sill+v*ST.width)])),
      cw=E.band?E.band.n*ST.width+(E.band.n-1)*E.band.gap:b.x1-b.x0,ch=b.y1-b.y0,cx=0,cy=(b.y0+b.y1)/2,
      d=Math.max(ch/(.66*.768),cw/((E.band?1:.8)*.768*9/16)),sd=si%2?1:-1,az0=sd*.16,az1=-sd*.06,R=E.room;
    const n0=Math.round(si*per),n1=Math.round((si+1)*per);
    for(let f=n0;f<n1;f++){
      const t=(f-n0)/(n1-n0-1),e=ease(t),dist=d*(1.1-.14*e),az=az0+(az1-az0)*e;
      setTod(.12+.08*t);
      const tgt=v3(cx,cy+ch*.04,0),pos=v3(Math.sin(az)*dist,Math.min(cy-ch*.18+ch*.08*e,R[2]-.5),E.depth+Math.cos(az)*dist);
      pos.z=Math.min(pos.z,E.depth+R[3]-.4);pos.x=clamp(pos.x,R[0]+.4,R[1]-.4);
      camera.position.copy(pos);camera.lookAt(tgt);U.uTime.value=f/FPS;
      tone.uniforms.uExp.value=1.5*ease(clamp(Math.min((f-n0+1)/fade,(n1-f)/fade),0,1));
      composer.render();
      ox.drawImage(canvas,0,0);
      const W=out.width,H=out.height,a=clamp(Math.min((f-n0-6)/10,(n1-f-4)/8),0,1);
      ox.save();ox.globalAlpha=a;ox.textAlign='center';ox.shadowColor='rgba(0,0,0,.65)';ox.shadowBlur=24;
      ox.fillStyle='#f1d49b';ox.font=`500 ${W*.03}px "JetBrains Mono"`;ox.fillText(ST.era.toUpperCase(),W/2,H*.86);
      ox.fillStyle='#f4ede0';ox.font=`italic 500 ${W*.075}px "Cormorant Garamond"`;ox.fillText(ST.name,W/2,H*.86+W*.085);
      ox.font=`400 ${W*.028}px Figtree`;ox.fillStyle='rgba(244,237,224,.85)';ox.fillText(ST.win.title.replace(/[“”]/g,''),W/2,H*.86+W*.135);ox.restore();
      ox.save();ox.globalAlpha=.8;ox.textAlign='center';ox.fillStyle='#f4ede0';ox.shadowColor='rgba(0,0,0,.6)';ox.shadowBlur=18;
      ox.font=`600 ${W*.045}px "Cormorant Garamond"`;ox.fillText('Lead & Light',W/2,H*.075);ox.restore();
      await send(i++)}}
  await fetch('/done',{method:'POST'})}
const FILM=HP.has('film');
resize();setTod(+$('#tod').value);
if(FILM)film();else load(true).then(()=>requestAnimationFrame(frame));
