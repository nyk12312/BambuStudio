/** Fixed-layer lower contacts. Changes support material only, never the part.
 * Deliberately limited to horizontal floors: a per-vertex snap on a curved floor
 * interpolates through sampling planes between stations and can fuse again.
 */
export const LOWER_MARGIN = 0.002; // mm: clear float32/STL and slicing-plane ties
const FLAT = 1e-5;

export function lowerContact(floor, requested, profile) {
  if (!profile || !(requested > 0) || !(floor > 0)) return null;
  const { height: h, first } = profile;
  const blocked = reason => ({ status: 'blocked', requested, reason });
  if (![h, first].every(v => Number.isFinite(v) && v >= 0.04 && v <= 0.6))
    return blocked('set valid fixed regular and first-layer heights (0.04–0.60 mm)');
  const plane = i => i === 0 ? first / 2 : first + (i - 0.5) * h;
  const below = z => z < plane(0) ? -1 : z < plane(1) ? 0 : Math.floor((z - plane(1)) / h) + 1;
  const last = below(floor);
  if (last < 0) return blocked('the underlying floor does not reach a slicing plane');
  if ([last, last + 1].some(i => Math.abs(plane(i) - floor) < LOWER_MARGIN))
    return blocked('the floor is on a slicing boundary; change the first-layer height or use finer layers');
  let bottom = Math.max(floor + requested, plane(last + 1) + LOWER_MARGIN);
  const k = below(bottom);
  for (const i of [k, k + 1]) if (i >= 0 && Math.abs(plane(i) - bottom) < LOWER_MARGIN)
    bottom = Math.max(bottom, plane(i) + LOWER_MARGIN);
  const firstFin = below(bottom) + 1;
  return { status: 'aligned', floor, requested, bottom, geometricGap: bottom - floor,
    effectiveGap: (firstFin - last - 1) * h,
    lastPartPrintZ: first + last * h, firstFinPrintZ: first + firstFin * h,
    height: h, first, compensated: bottom > floor + requested + 1e-7 };
}

/** Describe slicing of an existing geometric gap; never move the contact.
 * A boundary tie is reported as uncertain rather than a promised separation.
 */
export function slicedLowerGap(floor, bottom, profile) {
  const {height:h,first}=profile;
  if (![h,first].every(v=>Number.isFinite(v)&&v>=.04&&v<=.6)
      || ![floor,bottom].every(Number.isFinite) || !(floor>0) || !(bottom>floor)) return {status:'unknown'};
  const plane=i=>i===0?first/2:first+(i-.5)*h;
  const below=z=>z<plane(0)?-1:z<plane(1)?0:Math.floor((z-plane(1))/h)+1;
  const last=below(floor), k=below(bottom);
  if(last<0) return {status:'unknown'};
  const boundary=[last,last+1].some(i=>Math.abs(plane(i)-floor)<LOWER_MARGIN)
    || [k,k+1].some(i=>i>=0&&Math.abs(plane(i)-bottom)<LOWER_MARGIN);
  return {status:boundary?'boundary':'predicted',effectiveGap:(k-last)*h,
    lastPartPrintZ:first+last*h,firstFinPrintZ:first+(k+1)*h};
}

function flatLowerStart(top, floor, physical) {
  if (floor.some(f=>f[2]<=0)) return {reason:'mixed plate/part start: the bed contact must remain at Z=0'};
  const z=Math.min(...floor.flatMap(f=>[f[2],f[3]??f[2],f[4]??f[2]]));
  if (!(z>0)) return {reason:'mixed plate/part start: the bed contact must remain at Z=0'};
  const flat=f=>[2,3,4].every(k=>Math.abs((f[k]??f[2])-z)<=FLAT);
  let span=0,longest=0;
  for(let i=1;i<floor.length;i++) {
    const backed=[i-1,i].every(k=>flat(floor[k])&&flat(physical[k]));
    span=backed?span+Math.hypot(top[i][0]-top[i-1][0],top[i][1]-top[i-1][1]):0;
    longest=Math.max(longest,span);
  }
  return {z,longest};
}

/** Metadata only, after the unchanged sweep/repair. Curved starts do not acquire
 * a fictitious uniform measured clearance. The UI supplies its slicing profile.
 */
export function geometricLowerContact(top, floor, physical, requested) {
  const seed=flatLowerStart(top,floor,physical);
  if(seed.reason||!(seed.longest>0)) return {status:'geometric',requested,
    reason:seed.reason??'no flat backed lower start; generated clearance varies along the contour and sliced separation is not predicted'};
  return {status:'geometric',requested,floor:seed.z,bottom:seed.z+requested,
    geometricGap:requested,scope:'flat-start'};
}

/** Raise the virtual floor consumed by the existing sweep/start certification.
 * The lift is uniform within each eligible flat contact, preserving its full width.
 * Geometric mode and non-flat floors retain the original contour byte for byte.
 */
export function alignLowerContact(top, floor, requested, upperGap, profile, tipHeight = 0) {
  if (!profile || !(requested > 0) || floor.every(f => f[2] === 0)) return { floor };
  const z = floor[0][2];
  if (!(z > 0) || floor.some(f => [2, 3, 4].some(k => Math.abs((f[k] ?? f[2]) - z) > FLAT)))
    return { floor, lowerContact: { status: 'geometric', requested,
      reason: 'non-flat or mixed plate/part contact: layer alignment is not applied' } };
  const contact = lowerContact(z, requested, profile);
  if (contact.status === 'blocked') return { floor, lowerContact: contact };
  const lift = contact.bottom - z - requested;
  // Keep at least two layers of body plus the existing upper contact. A failed
  // contact is reported by callers; never fall back to the potentially fused fin.
  const minBody = Math.max(0.2, 2 * profile.height, lift > 1e-9 ? tipHeight + 0.1 : 0);
  if (top.some(p => p[2] - upperGap - contact.bottom < minBody))
    return { floor, lowerContact: { ...contact, status: 'blocked', reason: 'not enough headroom for a layer-aligned lower contact' } };
  return { floor: lift > 1e-9 ? floor.map(f => f.map((v, k) => k >= 2 && k <= 4 ? v + lift : v)) : floor,
    lowerContact: contact };
}

/** A repaired contour may start on a flat terrace and climb away from it.
 * Align that certified start, not the sloping raw floor under its far end.
 * Lift the complete bottom uniformly: independently snapped stations would
 * interpolate back through the supposedly empty plane. The caller re-certifies
 * the result with the existing start algorithm and collision checks.
 */
export function alignLowerStart(top, floor, physical, requested, upperGap, profile, tipHeight = 0) {
  const geometric = reason => ({ floor, lowerContact: { status: 'geometric', requested, reason } });
  // Both the constructed seed and its actual backing must be flat. A horizontal
  // repair hovering over a slope is not an eligible physical contact.
  const {z,longest,reason}=flatLowerStart(top,floor,physical);
  if(reason) return geometric(reason);
  if (longest < 2 * profile.height)
    return geometric('no flat backed start spanning two layer heights after start repair; curved/sloped contacts retain geometric gaps');
  const c = lowerContact(z, requested, profile);
  if (c.status === 'blocked') return { floor, lowerContact: c };
  const lift = c.geometricGap - requested;
  const minBody = Math.max(.2, 2 * profile.height, lift > 1e-9 ? tipHeight + .1 : 0);
  if (top.some((p,i) => p[2] - upperGap - Math.max(...floor[i].slice(2,5)) - requested - lift < minBody))
    return { floor, lowerContact: { ...c, status:'blocked', reason:'not enough headroom for a layer-aligned lower start' } };
  return { floor: lift > 1e-9 ? floor.map(f => f.map((v,k) => k>=2 && k<=4 ? v+lift : v)) : floor,
    lowerContact: { ...c, scope:'flat-start',
      reason:'separation applies to the flat backed start; the sloped/repaired remainder retains geometric certification' } };
}
