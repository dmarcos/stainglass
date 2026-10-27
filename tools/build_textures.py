"""Usage: python3 tools/build_textures.py [name ...]
Reads tools/photos/, writes windows/<name>_{c.jpg,l.png,i.png,src.jpg} and windows/meta.json.

Photo of a leaded window -> glass colour, line map, iron map.
  * Lines keep the width they have in the photograph (darkness relative to the surrounding glass).
  * A watershed of the dark lines splits the window into pieces; dark lines that run along piece
    boundaries become lead came (R channel, with relief), the rest is painted detail (G channel).
  * Glass colour under lines is filled from the nearest clear glass, so paint and lead sit on top of it.
The Chartres window is first sharpened with a higher-resolution detail photo (needs OpenCV)."""
import json, sys, os, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PH = os.path.join(ROOT, 'tools', 'photos'); OUT = os.path.join(ROOT, 'windows')

# crop: image fractions [x0,y0,x1,y1]; res: long side in px; bright: seed level for pieces (relative to local glass)
# hw: typical lead half width in px at that resolution; iron: min width in px of bars detected as iron
W = {
 'gothic':     dict(src='gothic_hd', crop=[.14,.032,.87,.99], shape=('pointed',.176,1.15), res=4600, bright=.62, hw=3.2, iron=14, minseed=80),
 'gothic_n':   dict(src='gothic_context', crop=[.576,.242,.913,.934], shape=('pointed',.214,1.34), res=2400, bright=.6, hw=2.0, minseed=40),
 'gothic_o':   dict(src='gothic_context', crop=[.433,.119,.617,.224], shape=('circle',), square=True, res=900, bright=.6, hw=1.6, minseed=30),
 'victorian':  dict(src='victorian', crop=[.022,.03,.985,.972], shape=('rect',), res=3400, bright=.62, hw=2.4, minseed=60),
 'nouveau':    dict(src='nouveau', crop=[.004,.004,.982,.996], shape=('rect',), res=2700, bright=.62, hw=1.9, minseed=50),
 'deco':       dict(src='deco', crop=[.012,.004,.99,.996], shape=('rect',), res=2800, bright=.6, hw=2.6, iron=9, minseed=60),
 # Tichenor casements: the oak sash bars are cut out of the glass and modelled in 3D (bars in crop fractions)
 'mission_left':  dict(src='mission_left', crop=[.052,.125,.962,.862], shape=('rect',), res=2048, bright=.6, hw=3.0, minseed=60, bars=[[.163,.241],[.768,.847]]),
 'mission':       dict(src='mission', crop=[.055,.11,.958,.88], shape=('rect',), res=2048, bright=.6, hw=3.0, minseed=60, bars=[[.159,.240],[.761,.840]]),
 'mission_right': dict(src='mission_right', crop=[.052,.102,.952,.895], shape=('rect',), res=2048, bright=.6, hw=3.0, minseed=60, bars=[[.160,.240],[.763,.843]]),
 'prairie':    dict(src='prairie', crop=[.046,.024,.955,.986], shape=('rect',), res=2600, bright=.8, hw=1.6, minseed=25, dk=(.8,.52)),   # light brass cames on white
 'mackintosh': dict(src='mackintosh', crop=[.088,.03,.905,.918], shape=('mack',), res=2048, bright=.7, hw=2.2, minseed=60),
}

def outline(sh, w, h):
    if sh[0] == 'rect': return [(0,0),(w,0),(w,h),(0,h)]
    if sh[0] == 'circle': return [(w/2+np.cos(a)*w/2, h/2+np.sin(a)*h/2) for a in np.linspace(0, 2*np.pi, 96, endpoint=False)]
    if sh[0] == 'pointed':   # two-centred arch: spring height (fraction of h), radius in half-widths
        b = w/2; s = sh[1]*h; R = sh[2]*b; rise = np.sqrt(R*R-(R-b)**2)
        left = [(t*b, s-np.sqrt(max(R*R-(t*b-R)**2, 0))) for t in np.linspace(0, 1, 41)[1:-1]]
        right = [(w-x, y) for x, y in reversed(left)]
        return [(0,h),(0,s)]+left+[(b,s-rise)]+right+[(w,s),(w,h)]
    if sh[0] == 'mack':      # flat head with an ogee peak
        top = .124*h; pts = [(0,h),(0,top),(.33*w,top)]
        for i in range(1,21): t=i/20; pts.append(((.33+.165*t)*w, top*(1-np.sin(t*np.pi/2)**.8)))
        for i in range(1,21): t=i/20; pts.append(((.495+.165*t)*w, top*(1-np.cos(t*np.pi/2)**.8)))
        return pts+[(w,top),(w,h)]

def rectify_rose(a):
    """Fit an exact rose (hub, ring of roundels, petals) to a photographed rose window and unwarp the photo onto it.
    Returns the warped image and the tracery openings as polygons in [0,1] coordinates."""
    import cv2
    S = a.shape[0]
    lum = ndi.gaussian_filter(a.max(2), 2); sat = ndi.gaussian_filter((a.max(2)-a.min(2))/(a.max(2)+1e-3), 2)
    glass = lambda lum,sat: ndi.binary_opening(ndi.binary_fill_holes(ndi.binary_closing((lum > .16) & (sat > .22), iterations=3)), iterations=4)
    g = glass(lum, sat); lab,n = ndi.label(g); comps = []
    for i,sl in enumerate(ndi.find_objects(lab)):
        r = lab[sl] == i+1; area = r.sum()
        if area < 200: continue
        hull = cv2.contourArea(cv2.convexHull(cv2.findNonZero(r.astype(np.uint8))))
        cy,cx = ndi.center_of_mass(r); comps.append((cx+sl[1].start, cy+sl[0].start, area, area/max(hull,1), (sl[1].stop-sl[1].start)/(sl[0].stop-sl[0].start)))
    hub = min(comps, key=lambda c: (c[0]-S/2)**2+(c[1]-S/2)**2)
    ring = [c for c in comps if c[3] > .9 and .7 < c[4] < 1.45 and c[2] > S*S*.004 and np.hypot(c[0]-hub[0], c[1]-hub[1]) > S*.36]
    ang = np.array([np.arctan2(c[1]-hub[1], c[0]-hub[0]) for c in ring]); rad = np.array([np.hypot(c[0]-hub[0], c[1]-hub[1]) for c in ring])
    da = np.diff(np.sort(ang)); step = np.median(da[da > .1]); N = int(round(2*np.pi/step)); step = 2*np.pi/N
    phi0 = np.angle(np.mean(np.exp(1j*N*ang)))/N
    R = .43*S; C = S/2
    ideal = [(C+R*np.cos(phi0+round((t-phi0)/step)*step), C+R*np.sin(phi0+round((t-phi0)/step)*step)) for t in ang]
    src = np.float32([[c[0],c[1]] for c in ring]+[[hub[0],hub[1]]]); dst = np.float32(ideal+[(C,C)])
    H,_ = cv2.findHomography(src, dst, 0)
    a = cv2.warpPerspective(a, H, (S,S), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)
    k = R/np.median(rad)                                          # scale from photo pixels to the ideal frame
    cr = np.sqrt(np.median([c[2] for c in ring])/np.pi)*k*1.02     # roundel radius
    hr = np.sqrt(hub[2]/np.pi)*k*1.02                              # hub radius
    # petals: count and measure them on the unwarped image
    lum = ndi.gaussian_filter(a.max(2), 2); sat = ndi.gaussian_filter((a.max(2)-a.min(2))/(a.max(2)+1e-3), 2); g = glass(lum, sat)
    th = np.linspace(-np.pi, np.pi, 2880, endpoint=False); rm = (hr+R-cr)/2
    prof = ndi.gaussian_filter1d(g[np.clip((C+rm*np.sin(th)).astype(int),0,S-1), np.clip((C+rm*np.cos(th)).astype(int),0,S-1)].astype(float), 6, mode='wrap')
    on = prof > .5; starts = [i for i in range(len(th)) if on[i] and not on[i-1]]
    NP = len(starts); pstep = 2*np.pi/NP
    centers = []
    for i in starts:
        j = i
        while on[j % len(th)]: j += 1
        centers.append(th[(i+j)//2 % len(th)])
    pphi = np.angle(np.mean(np.exp(1j*NP*np.array(centers))))/NP
    r1s,r2s,w1s,w2s = [],[],[],[]
    for t in centers:
        rr = np.arange(int(hr), int(R))
        ray = g[np.clip((C+rr*np.sin(t)).astype(int),0,S-1), np.clip((C+rr*np.cos(t)).astype(int),0,S-1)]
        k0 = int(rm-hr); 
        if not ray[k0]: continue
        a0 = k0; b0 = k0
        while a0 > 0 and ray[a0-1]: a0 -= 1
        while b0 < len(rr)-1 and ray[b0+1]: b0 += 1
        r1,r2 = rr[a0], rr[b0]; r1s.append(r1); r2s.append(r2)
        for frac,store in [(.15,w1s),(.75,w2s)]:
            rq = r1+frac*(r2-r1); tt = np.linspace(t-pstep/2, t+pstep/2, 200)
            arc = g[np.clip((C+rq*np.sin(tt)).astype(int),0,S-1), np.clip((C+rq*np.cos(tt)).astype(int),0,S-1)]
            store.append(arc.sum()/200*pstep*rq)
    r1,r2,w1,w2 = np.median(r1s),np.median(r2s),np.median(w1s),np.median(w2s)
    w1,w2 = w1*1.25, w2*1.3                                       # dark leads inside the glass make the measured width short
    print(f'  rose: {N} roundels r={cr/S:.3f}, hub r={hr/S:.3f}, {NP} petals {r1/S:.3f}-{r2/S:.3f} w {w1/S:.3f}/{w2/S:.3f}')
    polys = [[[ (C+hr*np.cos(t))/S, (C+hr*np.sin(t))/S ] for t in np.linspace(0, 2*np.pi, 72, endpoint=False)]]
    for kk in range(N):
        t0 = phi0+kk*step; cx,cy = C+R*np.cos(t0), C+R*np.sin(t0)
        polys.append([[(cx+cr*np.cos(t))/S, (cy+cr*np.sin(t))/S] for t in np.linspace(0, 2*np.pi, 40, endpoint=False)])
    for kk in range(NP):
        t0 = pphi+kk*pstep; d = np.array([np.cos(t0), np.sin(t0)]); nrm = np.array([-d[1], d[0]])
        cap = w2/2; L = []; Rr = []
        for q in np.linspace(0, 1, 16):
            rq = r1+w1/2 + q*(r2-cap-r1-w1/2); wq = (w1+(w2-w1)*q**.8)/2
            L.append(C*np.ones(2)+d*rq+nrm*wq); Rr.append(C*np.ones(2)+d*rq-nrm*wq)
        outer = [C*np.ones(2)+d*(r2-cap)+cap*(np.cos(t)*d+np.sin(t)*nrm) for t in np.linspace(np.pi/2, -np.pi/2, 12)]
        inner = [C*np.ones(2)+d*(r1+w1/2)+(w1/2)*(np.cos(t)*d+np.sin(t)*nrm) for t in np.linspace(-np.pi/2, -3*np.pi/2, 8)]
        polys.append([[p[0]/S, p[1]/S] for p in L+outer+Rr[::-1]+inner])
    return a, [[[round(float(x),4), round(float(y),4)] for x,y in p] for p in polys]

def sharpen_chartres():
    """Align the high-resolution detail photo onto the full-window photo and blend it in."""
    out = os.path.join(PH, 'gothic_hd.jpg')
    if os.path.exists(out): return
    import cv2
    base = cv2.imread(os.path.join(PH, 'gothic.jpg')); det = cv2.imread(os.path.join(PH, 'gothic_detail.jpg'))
    bu = cv2.resize(base, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    sift = cv2.SIFT_create(12000)
    k1, d1 = sift.detectAndCompute(cv2.cvtColor(bu, cv2.COLOR_BGR2GRAY), None)
    k2, d2 = sift.detectAndCompute(cv2.cvtColor(det, cv2.COLOR_BGR2GRAY), None)
    good = [a for a, b in cv2.BFMatcher().knnMatch(d2, d1, k=2) if a.distance < .72*b.distance]
    H, _ = cv2.findHomography(np.float32([k2[a.queryIdx].pt for a in good]), np.float32([k1[a.trainIdx].pt for a in good]), cv2.RANSAC, 4.0)
    wa = cv2.warpPerspective(det, H, bu.shape[1::-1], flags=cv2.INTER_LANCZOS4)
    mk = cv2.warpPerspective(np.full(det.shape[:2], 255, np.uint8), H, bu.shape[1::-1])
    mk = cv2.GaussianBlur(cv2.erode(mk, np.ones((15,15), np.uint8)), (61,61), 0).astype(np.float32)[..., None]/255
    ov = mk[..., 0] > .9
    for c in range(3):
        a = wa[..., c][ov].astype(np.float32); b = bu[..., c][ov].astype(np.float32)
        wa[..., c] = np.clip((wa[..., c]-a.mean())*b.std()/max(a.std(), 1)+b.mean(), 0, 255)
    cv2.imwrite(out, (wa*mk+bu*(1-mk)).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 94])

def build(name, c):
    im = Image.open(os.path.join(PH, c['src']+'.jpg')).convert('RGB'); iw, ih = im.size
    x0,y0,x1,y1 = c['crop']; im = im.crop((int(x0*iw),int(y0*ih),int(x1*iw),int(y1*ih)))
    w,h = im.size; s = min(1, c['res']/max(w,h))
    if c.get('square'): im = im.resize((max(w,h),)*2, Image.LANCZOS); w,h = im.size
    if c.get('upscale'): im = im.resize((w*c['upscale'], h*c['upscale']), Image.LANCZOS); w,h = im.size
    if s < 1: im = im.resize((round(w*s),round(h*s)), Image.LANCZOS)
    w,h = im.size; a = np.asarray(im).astype(np.float32)/255
    poly = outline(c['shape'], w, h)
    mi = Image.new('L',(w*2,h*2),0); ImageDraw.Draw(mi).polygon([(x*2,y*2) for x,y in poly], fill=255)
    mask = np.asarray(mi.resize((w,h),Image.LANCZOS)).astype(np.float32)/255; inside = mask > .5
    holes = []
    if c.get('rose'):
        a, holes = rectify_rose(a)
        mi2 = Image.new('L', (w*2,h*2), 0); dr = ImageDraw.Draw(mi2)
        for o in holes: dr.polygon([(x*w*2, y*h*2) for x,y in o], fill=255)
        op = ndi.binary_dilation(np.asarray(mi2.resize((w,h), Image.LANCZOS)) > 127, iterations=4)
        mask = ndi.gaussian_filter(op.astype(np.float32), .8); inside = op
    if c.get('facade'):   # a photographed stone façade: glass where the photo is saturated, stone elsewhere; the photo becomes the stone's surface
        import cv2
        lum0 = ndi.gaussian_filter(a.max(2), 1); sat0 = ndi.gaussian_filter((a.max(2)-a.min(2))/(a.max(2)+1e-3), 1)
        op = ndi.binary_fill_holes(ndi.binary_closing((sat0 > .38) & (lum0 > .12), iterations=1))
        op = ndi.binary_opening(op, iterations=2); lab,n = ndi.label(op); idx = range(1,n+1)
        sz = ndi.sum(op, lab, idx); ms = ndi.mean(sat0, lab, idx)
        op = np.isin(lab, 1+np.nonzero((sz > 300) & (ms > .5))[0])   # stone lit by coloured light is only faintly saturated
        cs,_ = cv2.findContours(op.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        hull = np.zeros(op.shape, np.uint8)
        for ct in cs:   # every opening here (roundel, petal, pointed light) is convex: the hull takes back pale glass at its edge
            hp = cv2.convexHull(ct); cv2.fillPoly(hull, [hp], 1)
            ap = cv2.approxPolyDP(hp, 1.0, True)[:,0,:]
            if len(ap) >= 3: holes.append([[round(float(x)/w,5),round(float(y)/h,5)] for x,y in ap])
        op = ndi.binary_dilation(hull > 0, iterations=c.get('grow',2))   # glass runs a little under the modelled stone
        if c.get('detail'):   # sharper glass from a second photo, aligned onto this one
            det = cv2.imread(os.path.join(PH, c['detail']+'.jpg'))
            clahe = lambda im: cv2.createCLAHE(3.0, (8,8)).apply(cv2.cvtColor(im, cv2.COLOR_BGR2GRAY))
            base = cv2.cvtColor((a*255).astype(np.uint8), cv2.COLOR_RGB2BGR)
            sift = cv2.SIFT_create(20000)
            k1,d1 = sift.detectAndCompute(clahe(base), None); k2,d2 = sift.detectAndCompute(clahe(det), None)
            good = [p for p,q in cv2.BFMatcher().knnMatch(d2, d1, k=2) if p.distance < .75*q.distance]
            Hm,_ = cv2.findHomography(np.float32([k2[p.queryIdx].pt for p in good]), np.float32([k1[p.trainIdx].pt for p in good]), cv2.RANSAC, 5.0)
            wa = cv2.cvtColor(cv2.warpPerspective(det, Hm, (w,h), flags=cv2.INTER_LANCZOS4), cv2.COLOR_BGR2RGB).astype(np.float32)/255
            wm = cv2.warpPerspective(np.full(det.shape[:2], 255, np.uint8), Hm, (w,h)); wm = ndi.binary_erosion(wm > 0, iterations=20) & op
            for ch in range(3):   # match exposure and colour to the base photo
                x_, y_ = wa[...,ch][wm], a[...,ch][wm]; wa[...,ch] = (wa[...,ch]-x_.mean())*y_.std()/max(x_.std(),1e-3)+y_.mean()
            blend = ndi.gaussian_filter(wm.astype(np.float32), 4)[..., None]
            a = np.clip(a*(1-blend) + wa*blend, 0, 1)
        mask = ndi.gaussian_filter(op.astype(np.float32), .8); inside = op
    if c.get('fill'):
        lum0 = ndi.gaussian_filter(a.max(2), 1.5); sat0 = (a.max(2)-a.min(2))/(a.max(2)+1e-3)
        glassmask = ndi.binary_fill_holes(ndi.binary_closing((lum0 > .12) & (sat0 > .15), iterations=2))
    if c.get('openings'):   # stone tracery: glass only inside the openings cut through the stone
        import cv2
        lum = ndi.gaussian_filter(a.max(2), 2); sat = ndi.gaussian_filter((a.max(2)-a.min(2))/(a.max(2)+1e-3), 2)
        op = ndi.binary_fill_holes(ndi.binary_closing((lum > .16) & (sat > .22), iterations=4))
        op = ndi.binary_opening(op, iterations=7)                 # cut thin bridges to sunlit stone
        def convex_parts(region, depth=0):   # openings are near-convex; split merged blobs by eroding harder
            lab,n = ndi.label(region); out = np.zeros_like(region)
            for i,sl in enumerate(ndi.find_objects(lab)):
                r = lab[sl] == i+1; area = r.sum()
                if area < 6e-4*w*h or sl[0].start <= 2: continue
                hull = cv2.contourArea(cv2.convexHull(cv2.findNonZero(r.astype(np.uint8))))
                if area/max(hull,1) > .86: out[sl] |= r
                elif depth < 3:
                    k = 6*(depth+1); core = ndi.binary_erosion(r, iterations=k)
                    out[sl] |= convex_parts(ndi.binary_dilation(core, iterations=k) & r, depth+1)
            return out
        op = convex_parts(op)
        if c.get('mirror'):   # the tracery is symmetric: fill in an opening whose twin was found but which merged with stone
            mir = op[:, np.clip(np.round(2*c['mirror']*w - np.arange(w)).astype(int), 0, w-1)]
            lab,n = ndi.label(mir)
            for i,sl in enumerate(ndi.find_objects(lab)):
                r = lab[sl] == i+1
                if (op[sl] & r).sum() < .5*r.sum(): op[sl] |= r
        cs,_ = cv2.findContours(op.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        for ct in cs:
            ap = cv2.approxPolyDP(ct, 1.2, True)[:,0,:]
            if len(ap) >= 3: holes.append([[round(float(x)/w,4),round(float(y)/h,4)] for x,y in ap])
        op = ndi.binary_dilation(op, iterations=3)          # a little glass under the stone's edge
        mask = ndi.gaussian_filter(op.astype(np.float32), .8); inside = op
    mx = ndi.gaussian_filter(a.max(2), .4)
    ref = np.maximum(ndi.maximum_filter(ndi.gaussian_filter(mx, 1.5*c['hw']+3), int(3*c['hw'])+5), .08)
    rel = np.clip(mx/ref, 0, 1)
    d0,d1 = c.get('dk',(.56,.26))                        # darkness range of lines relative to the surrounding glass
    dk = np.clip((d0-rel)/(d0-d1), 0, 1)              # line darkness, at the photo's own width
    hw = c['hw']
    iron = np.zeros_like(inside)
    if c.get('iron'):
        dark = (rel < .45) & inside
        blob = ndi.distance_transform_edt(dark) > c['iron']*.5
        iron = ndi.binary_dilation(blob, iterations=int(c['iron']*.5)+2) & dark
        lab,n = ndi.label(iron); sz = ndi.sum(iron, lab, range(1,n+1)); ok = np.zeros(n+1,bool)
        for i,sl in enumerate(ndi.find_objects(lab)):     # long, thin bars only
            L = max(sl[0].stop-sl[0].start, sl[1].stop-sl[1].start)
            ok[i+1] = L > 12*c['iron'] and sz[i] > .5*L*c['iron']
        iron = ok[lab]
    for bx0,bx1 in c.get('bars',[]):              # sash bars: not glass
        inside[:, int(bx0*w):int(bx1*w)] = False; mask[:, int(bx0*w):int(bx1*w)] = 0
    iron &= inside
    # pieces: watershed from bright seeds over line darkness
    seeds = ndi.binary_erosion((rel > c['bright']) & inside & ~iron, iterations=1)
    lab,n = ndi.label(seeds); sz = ndi.sum(seeds, lab, range(1,n+1))
    keep = np.zeros(n+1,bool); keep[1:] = sz >= c['minseed']; lab = np.where(keep[lab], lab, 0)
    lab[~inside] = n+1; lab[iron] = n+2
    ws = ndi.watershed_ift((np.clip(1-rel,0,1)*255).astype(np.uint8), lab.astype(np.int32))
    bnd = np.zeros_like(inside); bnd[:,1:] |= ws[:,1:] != ws[:,:-1]; bnd[1:,:] |= ws[1:,:] != ws[:-1,:]
    # a dark line on a piece boundary is lead; only its dark core counts, the photographic halo becomes glass
    near = ndi.distance_transform_edt(~bnd) < 2.2*hw + 1
    zone = ndi.gaussian_filter((near & ndi.binary_dilation(dk > .5, iterations=1)).astype(np.float32), .7)
    core = np.clip((d1+.14-rel)/.20, 0, 1)
    lead = core*zone
    lead[iron] = 1; lead *= inside
    paint = np.clip((d0-.09-rel)/.24, 0, 1)*(1-zone)*inside
    if c.get('fill'): g2 = ndi.binary_dilation(glassmask, iterations=2); lead *= g2; paint *= g2
    # glass colour under lines from the nearest clear glass
    src = inside & (dk < .05) & ~iron
    if c.get('fill'): src &= glassmask
    _, (iy,ix) = ndi.distance_transform_edt(~src, return_indices=True)
    col = a[iy,ix]; p = np.percentile(col.max(2)[src], 99.3); col = np.clip(col/max(p,.2)*.97, 0, 1)
    Image.fromarray((col*255+.5).astype(np.uint8)).save(f'{OUT}/{name}_c.jpg', quality=92, subsampling=0)
    Image.fromarray((np.stack([lead, paint, mask], 2)*255+.5).astype(np.uint8)).save(f'{OUT}/{name}_l.png', optimize=True)
    if iron.any(): Image.fromarray((iron*255).astype(np.uint8)).save(f'{OUT}/{name}_i.png', optimize=True)
    th = Image.open(os.path.join(PH, c['src']+'.jpg')).convert('RGB'); th.thumbnail((520,520)); th.save(f'{OUT}/{name}_src.jpg', quality=82)
    print(name, w, h, 'pieces', len(np.unique(ws))-2, 'lead %.1f%%' % (100*(lead>.3).mean()), 'paint %.1f%%' % (100*(paint>.3).mean()), 'iron %.1f%%' % (100*iron.mean()))
    return dict(w=w, h=h, hw=hw, iron=bool(iron.any()), openings=holes, bars=c.get('bars',[]), outline=[[round(x/w,4),round(y/h,4)] for x,y in poly])

if __name__ == '__main__':
    names = sys.argv[1:] or list(W)
    if any(W[n]['src'] == 'gothic_hd' for n in names): sharpen_chartres()
    mp = f'{OUT}/meta.json'; meta = json.load(open(mp)) if os.path.exists(mp) else {}
    for n in names: meta[n] = build(n, W[n])
    json.dump(meta, open(mp,'w'))
