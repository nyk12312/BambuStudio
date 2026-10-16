// Host adapter only. Geometry stays in the unchanged user-modified PrintFins snapshot.
import { computeFins } from './vendor/plugins/shared/engine/fins_entry.js';
import { applyTunables } from './vendor/web/fins.js';

export function generate({ positions, options = {} }) {
    if (!Array.isArray(positions) || !positions.length || positions.length % 9 ||
        positions.length > 900000 || !positions.every(Number.isFinite))
        throw new Error('PoC requires 1..100000 finite input triangles');
    const lowerFootGap = options.lowerFootGap ?? 0.2;
    if (!Number.isFinite(lowerFootGap) || lowerFootGap < 0 || lowerFootGap > 0.4)
        throw new Error('lowerFootGap must be 0..0.4 mm');
    const layerHeight = options.layerHeight ?? 0.2;
    const firstLayerHeight = options.firstLayerHeight ?? layerHeight;
    if (![layerHeight, firstLayerHeight].every(h => Number.isFinite(h) && h >= 0.04 && h <= 0.6))
        throw new Error('PoC requires fixed layer heights of 0.04..0.6 mm');
    if (Math.abs(firstLayerHeight - layerHeight) > 1e-6 && !options.alignLowerLayers)
        throw new Error('Different first-layer height requires alignLowerLayers in this snapshot adapter');
    const nozzle = options.nozzle ?? 0.4, bodyThickness = options.bodyThickness ?? 1;
    if (!Number.isFinite(nozzle) || nozzle < 0.1 || nozzle > 1.2 ||
        !Number.isFinite(bodyThickness) || bodyThickness < 1 || bodyThickness > 2.4)
        throw new Error('Snapshot requires nozzle 0.1..1.2 mm and bodyThickness 1..2.4 mm');
    // The older shared plugin entry does not forward the local lower-gap extension.
    // Reset all local mutable settings on EVERY request, including after an error.
    applyTunables({ propFootGap: lowerFootGap,
        propLowerLayers: options.alignLowerLayers ? { height: layerHeight, first: firstLayerHeight } : null,
        nozzle, bodyThickness,
        iface: false });
    const result = computeFins(Float64Array.from(positions), {
        layerHeight, mode: options.mode ?? 'auto', material: 'pla',
        bedPad: options.bedPad ?? true, padStyle: options.bedPad === false ? 'off' : 'auto',
        tines: options.tines ?? true, coverage: options.coverage ?? 0.5,
    });
    return { triangles: Array.from(result.triangles), offset: result.offset,
        pieces: result.pieces, stats: result.stats,
        settings: { lowerFootGap, layerHeight, firstLayerHeight,
            alignLowerLayers: !!options.alignLowerLayers } };
}
