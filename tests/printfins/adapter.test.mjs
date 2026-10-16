import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../../resources/printfins/adapter.mjs';
import { PROP } from '../../resources/printfins/vendor/web/prop/config.js';

// Independent closed box fixture; this is input geometry, not a support algorithm.
export function box(x0, x1, y0, y1, z0, z1) {
    const v = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],
        [x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
    return [[0,3,2,1],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[0,4,7,3]]
        .flatMap(([a,b,c,d]) => [...v[a],...v[b],...v[c],...v[a],...v[c],...v[d]]);
}
const shelf = [...box(-20,20,-8,8,0,5), ...box(-20,20,-8,8,20,24), ...box(18,20,-8,8,5,20)];
const options = { bedPad: false, tines: false, lowerFootGap: 0.1 };

test('custom engine returns separate pieces with exact, exhaustive triangle ranges', () => {
    const r = generate({ positions: shelf, options });
    assert.ok(r.triangles.length > 0);
    const covered = new Set();
    for (const piece of r.pieces) for (const [a,b] of piece.ranges) for (let t=a;t<b;++t) {
        assert.ok(!covered.has(t)); covered.add(t);
    }
    assert.equal(covered.size, r.triangles.length / 9);
    assert.equal(PROP.footGap, 0.1);
});

test('positioning maps back to translated input without changing the generated mesh', () => {
    const a = generate({ positions: shelf, options });
    const shift = [137.25, 88.125, 0];
    const b = generate({ positions: shelf.map((v,i) => v + shift[i%3]), options });
    assert.deepEqual(a.triangles, b.triangles);
    for (const [i,key] of ['x','y','z'].entries())
        assert.ok(Math.abs(a.offset[key] - b.offset[key] - shift[i]) < 1e-9);
});

test('lower gap reaches the local engine, changes geometry, and cannot leak between requests', () => {
    const a = generate({ positions: shelf, options });
    const b = generate({ positions: shelf, options: { ...options, lowerFootGap: 0.3 } });
    assert.notDeepEqual(a.triangles, b.triangles);
    const reset = generate({ positions: shelf, options });
    assert.deepEqual(a.triangles, reset.triangles);
    assert.equal(PROP.footGap, 0.1);
});

test('rejects malformed input and invalid settings instead of silently changing geometry', () => {
    for (const positions of [[], [0,1,2], Array(9).fill(NaN)])
        assert.throws(() => generate({ positions }));
    assert.throws(() => generate({ positions: shelf, options: { lowerFootGap: -1 } }));
    assert.throws(() => generate({ positions: shelf, options: { layerHeight: 0 } }));
    assert.throws(() => generate({ positions: shelf, options: { nozzle: 9 } }));
    assert.throws(() => generate({ positions: shelf, options: { bodyThickness: 0 } }));
    assert.throws(() => generate({ positions: shelf, options: { layerHeight: 0.16, firstLayerHeight: 0.2 } }));
});
