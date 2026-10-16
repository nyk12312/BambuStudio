/** First-layer footprints and a conservative, in-track 45 degree start repair.
 * Tops are never moved: a repaired wall grows from nearby terraces to the same
 * contact line. This module is shared by Auto and Full's automatically drawn walls.
 */
import { PROP } from './config.js';
import { sweepBetween } from './sweep.js';
import { surfaceHitsAt } from './surface.js';
import { solidClearance } from '../inside.js';
import { upperContact } from './clearance.js';

const EPS = 1e-6;
const MIN_RUN = 2;                   // continuous extrusion length, not total wall span
const MAX_LAYERS = 4096;             // refuse rather than skip analysis on extreme models

const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function contains(poly, p) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    if (Math.abs(cross(a, b, p)) < EPS && p[0] >= Math.min(a[0], b[0]) - EPS
      && p[0] <= Math.max(a[0], b[0]) + EPS && p[1] >= Math.min(a[1], b[1]) - EPS
      && p[1] <= Math.max(a[1], b[1]) + EPS) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function distance(poly, p) {
  if (contains(poly, p)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / Math.max(EPS * EPS, dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}
function touches(a, b) {
  if (a.some(p => contains(b, p)) || b.some(p => contains(a, p))) return true;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const p = a[i], q = a[(i + 1) % a.length], r = b[j], s = b[(j + 1) % b.length];
    if (Math.max(p[0], q[0]) + EPS < Math.min(r[0], s[0]) || Math.max(r[0], s[0]) + EPS < Math.min(p[0], q[0])
      || Math.max(p[1], q[1]) + EPS < Math.min(r[1], s[1]) || Math.max(r[1], s[1]) + EPS < Math.min(p[1], q[1])) continue;
    if (cross(p, q, r) * cross(p, q, s) <= EPS * EPS && cross(r, s, p) * cross(r, s, q) <= EPS * EPS) return true;
  }
  return false;
}

/** Actual horizontal intersections of the emitted triangles; XY has no preferred axis. */
export function startSlice(tris, z) {
  z += 1e-7;                         // avoid coplanar triangle/vertex ambiguity
  const nodes = new Map(), edges = [];
  const key = p => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`;
  for (let i = 0; i < tris.length; i += 3) {
    const tri = tris.slice(i, i + 3), pts = [];
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      if ((a[2] > z) === (b[2] > z)) continue;
      const t = (z - a[2]) / (b[2] - a[2]);
      pts.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
    if (pts.length !== 2 || key(pts[0]) === key(pts[1])) continue;
    const edge = { a: key(pts[0]), b: key(pts[1]), used: false };
    edges.push(edge);
    for (const p of pts) {
      const id = key(p);
      if (!nodes.has(id)) nodes.set(id, { p, edges: [] });
      nodes.get(id).edges.push(edge);
    }
  }
  const polys = [];
  for (const first of edges) {
    if (first.used) continue;
    const poly = [], begin = first.a;
    let at = begin, edge = first;
    do {
      poly.push(nodes.get(at).p); edge.used = true;
      at = edge.a === at ? edge.b : edge.a;
      edge = nodes.get(at).edges.find(e => !e.used);
    } while (at !== begin && edge && poly.length <= edges.length);
    if (at !== begin) return null;   // an open slice cannot be certified
    if (poly.length >= 3) polys.push(poly);
  }
  return polys;
}

function groups(polys) {
  const out = [];
  for (const p of polys) {
    const hit = out.filter(g => g.some(q => touches(p, q)));
    const merged = [p, ...hit.flat()];
    for (const g of hit) out.splice(out.indexOf(g), 1);
    out.push(merged);
  }
  return out;
}
const area = p => Math.abs(p.reduce((sum, a, i) => {
  const b = p[(i + 1) % p.length]; return sum + a[0] * b[1] - b[0] * a[1];
}, 0)) / 2;

/** Boundaries plus interior grid points: enough backing over a nozzle-sized footprint. */
function samples(poly, pitch) {
  const pts = [...poly];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / pitch);
    for (let k = 1; k < n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  // Sample in the footprint's frame: a long diagonal fin must not scan its
  // entire world-XY bounding square or depend on its angle on the plate.
  const a = poly[0], b = poly.reduce((p, q) => Math.hypot(q[0]-a[0],q[1]-a[1]) > Math.hypot(p[0]-a[0],p[1]-a[1]) ? q : p);
  const n = Math.hypot(b[0]-a[0],b[1]-a[1]) || 1, ux = (b[0]-a[0])/n, uy = (b[1]-a[1])/n;
  const local = poly.map(p => [(p[0]-a[0])*ux+(p[1]-a[1])*uy, -(p[0]-a[0])*uy+(p[1]-a[1])*ux]);
  const xs = local.map(p=>p[0]), ys = local.map(p=>p[1]);
  for (let x = Math.min(...xs) + pitch / 2; x < Math.max(...xs); x += pitch)
    for (let y = Math.min(...ys) + pitch / 2; y < Math.max(...ys); y += pitch) if (contains(local,[x,y])) pts.push([a[0]+x*ux-y*uy,a[1]+x*uy+y*ux]);
  return pts;
}
const backed = (part, p, z, h, first) => z <= first + EPS || surfaceHitsAt(part, p[0], p[1]).some(([floor, nz]) =>
  nz > 0 && floor < z + EPS && z - floor <= PROP.footGap + h + EPS);

// Bambu's fixed-height sampling planes: first/2, first+h/2, first+3h/2, ...
// Keep the legacy uniform grid when a caller supplies only the regular height.
const layerZ = (i, h, first) => i === 0 ? first / 2 : first + (i - 0.5) * h;
const layerAt = (z, h, first) => z <= first / 2 + EPS ? 0
  : Math.max(1, Math.ceil((z - first) / h + 0.5 - EPS));

/** Inspect every new component through the first three layers after the highest bottom.
 * A growing component must be supported by the previous slice within 45 degrees,
 * or by the actual part below (with the selected lower gap).
 */
export function printableStart(tris, part, line, bottomMax, layerHeight = PROP.tineH, firstLayerHeight = layerHeight) {
  const h = Number.isFinite(layerHeight) && layerHeight > 0 ? layerHeight : PROP.tineH;
  const first = firstLayerHeight === undefined ? h : firstLayerHeight;
  if (!Number.isFinite(first) || first <= 0) return { ok: false, why: 'invalid first-layer height' };
  const minZ = tris.reduce((z, p) => Math.min(z, p[2]), Infinity);
  const begin = layerAt(minZ, h, first);
  const count = layerAt(bottomMax + 3 * h, h, first) - begin;
  if (!tris.length || count > MAX_LAYERS) return { ok: false, why: 'start analysis limit' };
  const a = line[0], b = line.at(-1), n = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(n > EPS)) return { ok: false, why: 'no start axis' };
  const ux = (b[0] - a[0]) / n, uy = (b[1] - a[1]) / n;
  const bead = Math.min(PROP.tip, 0.4 * PROP.tineW / 0.5);
  let prev = [], found = false;
  for (let k = 0; k <= count; k++) {
    const z = layerZ(begin + k, h, first);
    // Bambu excludes a solid's bottom edge exactly on the plane (Fusion's
    // reference contact), and includes its top edge. startSlice's public
    // coplanar bias is upward, so offset it to inspect just below this plane.
    const polys = startSlice(tris, z - 2e-7);
    if (polys === null) return { ok: false, why: 'open start slice', z };
    for (const component of groups(polys)) {
      const joined = component.some(p => prev.some(q => touches(p, q)));
      let initialBacking = [];
      if (!joined) {
        const all = component.flat(), along = all.map(p => (p[0] - a[0]) * ux + (p[1] - a[1]) * uy);
        const length = Math.max(...along) - Math.min(...along);
        // Maximum area is a lower bound on the union of overlapping closed solids.
        const footprint = Math.max(...component.map(area));
        if (length < MIN_RUN - EPS || footprint / Math.max(length, EPS) < bead * 0.8)
          return { ok: false, why: 'isolated short or narrow start', z, length, area: footprint };
        const pts = samples(component.reduce((p, q) => area(p) > area(q) ? p : q), bead / 2);
        initialBacking = pts.filter(p => backed(part, p, z, h, first));
        if (initialBacking.length < pts.length * 0.8)
          return { ok: false, why: 'insufficient start backing', z };
      }
      for (const poly of component) for (const p of samples(poly, bead / 2)) {
        // A first layer can extend by at most one layer's run from its broad
        // backed core inside the same continuous footprint. Requiring backing
        // under every boundary point would reject the first 45 degree increment.
        if (!backed(part, p, z, h, first) && !prev.some(q => distance(q, p) <= h + 2e-5)
          && !initialBacking.some(q=> {
            const d=Math.hypot(q[0]-p[0],q[1]-p[1]);
            if(d<=h+2e-5)return true;
            const reach=[p[0]+(q[0]-p[0])*h/d,p[1]+(q[1]-p[1])*h/d];
            return component.some(poly=>contains(poly,reach))&&backed(part,reach,z,h,first);
          }))
          return { ok: false, why: 'start grows beyond 45 degrees', z, point: p };
      }
      found = true;
    }
    prev = polys;
  }
  return { ok: found, why: found ? undefined : 'no printable start layers' };
}

/** Bottom vertex heights as sweepBetween actually emits them. */
function bottoms(top, floor) {
  return floor.map((f, i) => {
    const g = f[2] > 0 ? PROP.footGap : 0, bot = f[2] + g;
    if (!(g > 0) || f.length < 5) return [bot, bot];
    const cap = Math.max(bot, top[i][2] - PROP.gap - 0.5);
    return [Math.min(f[3] + g, cap), Math.min(f[4] + g, cap)];
  });
}

/** Preserve valid starts byte for byte. Search all nearby flat intervals on the
 * same contour before refusing. Raised bottoms remove material; they cannot
 * create an intersection outside the original wall, nor move its contact top.
 */
export function stableStart(top, floor, part, layerHeight, minH = PROP.minHeight, firstLayerHeight = layerHeight) {
  const h = Number.isFinite(layerHeight) && layerHeight > 0 ? layerHeight : PROP.tineH;
  const first = firstLayerHeight === undefined ? h : firstLayerHeight;
  if (!Number.isFinite(first) || first <= 0) return { ok: false, why: 'invalid first-layer height' };
  const original = [];
  if (!sweepBetween(top, floor, original, minH)) return { ok: false, why: 'wall does not fit' };
  const bot = bottoms(top, floor), maxBottom = Math.max(...bot.flat());
  const verdict = printableStart(original, part, top, maxBottom, h, first);
  if (verdict.ok) return { ok: true, top, floor, tris: original, repaired: false };
  const s = [0];
  for (let i = 1; i < top.length; i++) s.push(s[i - 1] + Math.hypot(top[i][0] - top[i - 1][0], top[i][1] - top[i - 1][1]));
  const seeds = [], mins = [], maxs = [];
  const ranges = floor.map((f,i) => {
    const z=f[2]+(f[2]>0?PROP.footGap:0);
    return [Math.min(z,...bot[i]),Math.max(z,...bot[i])];
  });
  const supported = floor.map((f,i) => {
    const a=top[Math.max(0,i-1)],b=top[Math.min(top.length-1,i+1)],n=Math.hypot(b[0]-a[0],b[1]-a[1])||1;
    const sx=(b[1]-a[1])/n,sy=-(b[0]-a[0])/n;
    const width=PROP.footGap>0?PROP.th:Math.min(PROP.th,PROP.tip+(PROP.th-PROP.tip)*h/(2*PROP.tipH));
    const z=layerZ(layerAt(ranges[i][1],h,first),h,first);
    let nBacked=0;
    for(let k=0;k<10;k++) {
      const o=width*((k+0.5)/10-0.5);
      if(backed(part,[f[0]+sx*o,f[1]+sy*o],z,h,first))nBacked++;
    }
    return nBacked>=8;
  });
  let a=0;
  for (let b=0;b<floor.length;b++) {
    if(!supported[b]){mins.length=0;maxs.length=0;a=b+1;continue;}
    while(mins.length&&ranges[mins.at(-1)][0]>=ranges[b][0])mins.pop();
    while(maxs.length&&ranges[maxs.at(-1)][1]<=ranges[b][1])maxs.pop();
    mins.push(b);maxs.push(b);
    while(a<=b&&ranges[maxs[0]][1]-ranges[mins[0]][0]>h/4+EPS) {
      a++;if(mins[0]<a)mins.shift();if(maxs[0]<a)maxs.shift();
    }
    if(a<=b&&s[b]-s[a]>=MIN_RUN)seeds.push({a:s[a],b:s[b],z:ranges[maxs[0]][1]});
  }
  if (!seeds.length) return { ok: false, why: verdict.why, detail: verdict };
  const planned = floor.map((f, i) => {
    const envelope = Math.min(...seeds.map(seed => seed.z + Math.max(0, seed.a - s[i], s[i] - seed.b)));
    const bottom = Math.max(...bot[i], f[2] + (f[2] > 0 ? PROP.footGap : 0), envelope);
    const g = bottom > EPS ? PROP.footGap : 0;
    return [f[0], f[1], bottom - g, bottom - g, bottom - g];
  });
  // Never move or trim the contact line to make a repair appear successful.
  // Leave at least two print layers and a nonzero top taper at every original
  // contact, including low tails; a geometric sliver is not useful support.
  const minWall=Math.max(0.2,2*h);
  if (planned.some((f, i) => top[i][2] - PROP.gap - f[2] - (f[2] > 0 ? PROP.footGap : 0) < minWall))
    return { ok: false, why: 'no headroom for a stable start' };
  const tris = [];
  // minHeight measured the original floor; the raised start needs positive wall,
  // not another minHeight of artificial headroom above the growing 45 degree rib.
  if (!sweepBetween(top, planned, tris, 0.1)) return { ok: false, why: 'stable start does not fit' };
  const check = printableStart(tris, part, top, Math.max(...bottoms(top, planned).flat()), h, first);
  return check.ok ? { ok: true, top, floor: planned, tris, repaired: true }
    : { ok: false, why: check.why, detail: check };
}

/** Exact widened/repaired-wall certification, including between stations.
 * Only its actual bottom and upper contact may approach the part with their
 * respective gaps; an accepted contact cannot mask a bad body flank.
 */
export function attachedCollision(tris, top, floor, topo, rot, offset, partTris = null) {
  const contained = containedPart(tris, topo, rot, offset);
  if (contained) return contained;
  const bot = bottoms(top, floor);
  let surface=partTris;
  const seated = () => {
    if(!surface) {
      surface=new Float64Array(topo.pos.length);
      for(let i=0;i<surface.length;i+=3) {
        const p=topo.pos,x=p[i],y=p[i+1],z=p[i+2];
        surface[i]=rot[0]*x+rot[3]*y+rot[6]*z+offset.x;
        surface[i+1]=rot[1]*x+rot[4]*y+rot[7]*z+offset.y;
        surface[i+2]=rot[2]*x+rot[5]*y+rot[8]*z+offset.z;
      }
    }
    return surface;
  };
  const onFloor=(x,y,z)=>surfaceHitsAt(seated(),x,y).some(([height,nz])=>nz>0&&Math.abs(height-z)<EPS);
  const upper=upperContact(top,seated);
  const bottomAt = (x, y) => {
    let best = Infinity, height = 0;
    for (let i = 0; i + 1 < top.length; i++) {
      const a = top[i], b = top[i + 1], dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / Math.max(EPS, dx * dx + dy * dy)));
      const d = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
      if (d < best) {
        best = d;
        const n=Math.hypot(dx,dy)||1;
        const across=((x-a[0])*dy-(y-a[1])*dx)/n;
        const v=Math.max(0,Math.min(1,across/PROP.th+0.5));
        height=(bot[i][0]*(1-v)+bot[i][1]*v)*(1-t)+(bot[i+1][0]*(1-v)+bot[i+1][1]*v)*t;
      }
    }
    return height;
  };
  return solidClearance(topo, rot, offset, tris, 0.25, hit => {
    const nz = rot[2] * topo.nrm[hit.face * 3] + rot[5] * topo.nrm[hit.face * 3 + 1] + rot[8] * topo.nrm[hit.face * 3 + 2];
    const bottom = hit.z <= bottomAt(hit.x, hit.y) + EPS;
    if (upper(hit)) return hit.d < PROP.gap * 0.675 - EPS;
    if (hit.d < EPS) return !(PROP.footGap === 0 && Math.abs(hit.z-bottomAt(hit.x,hit.y)) <= EPS && onFloor(hit.x,hit.y,hit.z));
    // At a floor lip the same closest point also belongs to a vertical/slightly
    // inverted hole face. Classify that shared point, not whichever face the
    // distance traversal visits: otherwise a valid lower gap is tested against
    // the unrelated 0.205 mm flank clearance and toggles as the gap changes.
    if (bottom && hit.cosUp < 0 && (nz > 0 || hit.cosUp < -0.7
      || (hit.d < 0.205 && onFloor(hit.partX,hit.partY,hit.partZ))))
      return hit.d < PROP.footGap * 0.4 - EPS;
    return hit.cosUp > 0.7 ? hit.d < PROP.gap * 0.675 : hit.d < 0.205;
  });
}

/** A model feature wholly enclosed in the widened body has no crossing surfaces.
 * Surface-distance alone cannot see it. Signed vertical crossings also handle
 * overlapping wall/flange solids, where an ordinary odd/even test would cancel.
 */
export function containedPart(tris, topo, rot, offset) {
  const mesh = new Float64Array(tris.length * 3), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i++) for (let k = 0; k < 3; k++) {
    const v = tris[i][k]; mesh[i * 3 + k] = v; lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v);
  }
  for (let i = 0; i < topo.pos.length; i += 3) {
    const p = topo.pos, x = p[i], y = p[i + 1], z = p[i + 2];
    const q = [rot[0] * x + rot[3] * y + rot[6] * z + offset.x,
      rot[1] * x + rot[4] * y + rot[7] * z + offset.y, rot[2] * x + rot[5] * y + rot[8] * z + offset.z];
    if (q.some((v, k) => v <= lo[k] + EPS || v >= hi[k] - EPS)) continue;
    const hits = surfaceHitsAt(mesh, q[0], q[1]);
    if (hits.some(([height]) => Math.abs(height - q[2]) < EPS)) continue; // exact boundary is classified by distance
    const winding = hits.filter(([height]) => height < q[2]).reduce((sum, [, nz]) => sum + Math.sign(nz), 0);
    if (winding) return { d: 0, cosUp: 0, x: q[0], y: q[1], z: q[2] };
  }
  return null;
}
