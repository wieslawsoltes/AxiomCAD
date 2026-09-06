export function newBody(kind, params, extra = {}) { return { id: globalThis.crypto?.randomUUID?.() || 'body-' + Math.random().toString(36).slice(2), name: kind[0].toUpperCase() + kind.slice(1), kind, params, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, color: '#b9c7d1', material: 'aluminum', features: [], ...extra }; }
export function blankDocument() { return { schema: 'axiom-cad', version: 1, name: 'Untitled assembly', units: 'mm', bodies: [], sketches: [] }; }
export function bearingSample() {
    const doc = blankDocument();
    doc.name = 'Bearing support assembly';
    const base = newBody('box', { width: 148, depth: 96, height: 12, radius: 9 }, { name: 'Mounting plate', color: '#b9c7d1', material: 'aluminum', explode: [0, 0, -22] });
    for (const x of [-57, 57])
        for (const y of [-31, 31])
            base.features.push({ id: 'hole-' + x + '-' + y, type: 'hole', name: 'Mounting hole · Ø9', params: { radius: 4.5, depth: 16, x, y, z: -2, axis: 'Z' } });
    doc.bodies.push(base);
    // Rounded-top upright profile in XZ, extruded along negative Y.
    const profile = [[-37, 0], [37, 0], [37, 40]];
    for (let i = 1; i <= 40; i++) {
        let t = i * Math.PI / 40;
        profile.push([37 * Math.cos(t), 40 + 37 * Math.sin(t)]);
    }
    profile.push([-37, 0]);
    const housing = newBody('extrude', { points: profile, height: 28 }, { name: 'Bearing housing', position: [0, 14, 12], rotation: [90, 0, 0], color: '#347893', material: 'blue', explode: [0, 0, 42], features: [{ id: 'bearing-bore', type: 'hole', name: 'Bearing seat · Ø44', params: { radius: 22, depth: 32, x: 0, y: 40, z: -2, axis: 'Z' } }] });
    doc.bodies.push(housing);
    const bush = newBody('tube', { radius: 21.85, innerRadius: 14, height: 31 }, { name: 'Bronze bearing sleeve', position: [0, 15.5, 52], rotation: [90, 0, 0], color: '#c5a366', material: 'brass', explode: [0, -44, 42] });
    doc.bodies.push(bush);
    const lip = newBody('tube', { radius: 25, innerRadius: 14, height: 3.2 }, { name: 'Bearing flange', position: [0, -14, 52], rotation: [90, 0, 0], color: '#c5a366', material: 'brass', explode: [0, -48, 42] });
    doc.bodies.push(lip);
    const shaft = newBody('cylinder', { radius: 13.6, height: 106, bevel: 1.2 }, { name: 'Precision shaft · Ø27.2', position: [0, 51, 52], rotation: [90, 0, 0], color: '#a6b3bc', material: 'steel', explode: [0, -95, 42] });
    doc.bodies.push(shaft);
    const collar = newBody('tube', { radius: 19, innerRadius: 13.6, height: 12 }, { name: 'Shaft collar', position: [0, 42, 52], rotation: [90, 0, 0], color: '#4b565e', material: 'black', explode: [0, 51, 42] });
    doc.bodies.push(collar);
    for (const x of [-57, 57])
        for (const y of [-31, 31]) {
            doc.bodies.push(newBody('tube', { radius: 8.5, innerRadius: 4.5, height: 1.6 }, { name: 'Washer M8 · ' + (x < 0 ? 'L' : 'R') + (y < 0 ? 'F' : 'B'), position: [x, y, 12], color: '#a6b3bc', material: 'steel', explode: [x * .10, y * .10, 28] }));
            const screw = newBody('cylinder', { radius: 6.5, height: 8, bevel: .7, segments: 64 }, { name: 'Socket screw M8 · ' + (x < 0 ? 'L' : 'R') + (y < 0 ? 'F' : 'B'), position: [x, y, 13.6], color: '#4b565e', material: 'black', explode: [x * .10, y * .10, 56], features: [{ id: 'socket', type: 'hole', name: 'Hex socket · 6 mm', params: { radius: 3.45, depth: 6, x: 0, y: 0, z: 3, axis: 'Z', segments: 6 } }] });
            doc.bodies.push(screw);
        }
    doc.sketches.push({ id: 'mounting-footprint', name: 'Plate footprint', plane: 'XY', points: [[-74, -48], [74, -48], [74, 48], [-74, 48]], closed: true, visible: false });
    return doc;
}
export function gearboxSample() { let d = blankDocument(); d.name = 'Spur gear pair'; d.bodies.push(newBody('gear', { radius: 48, height: 12, teeth: 24, bore: 9 }, { name: 'Drive gear · 24 teeth', color: '#c5a366', material: 'brass', position: [-31, 0, 10], explode: [-15, 0, 30] }), newBody('gear', { radius: 28, height: 12, teeth: 14, bore: 7 }, { name: 'Pinion · 14 teeth', color: '#a6b3bc', material: 'steel', position: [41, 0, 10], rotation: [0, 0, 360 / 14 / 2], explode: [15, 0, 30] }), newBody('box', { width: 168, depth: 120, height: 8, radius: 10 }, { name: 'Gear plate', color: '#347893', material: 'blue', position: [0, 0, 0], explode: [0, 0, -20] })); for (const [x, r] of [[-31, 8.8], [41, 6.8]])
    d.bodies.push(newBody('cylinder', { radius: r, height: 32, bevel: .8 }, { name: 'Gear axle', position: [x, 0, 8], material: 'black', color: '#4b565e', explode: [0, 0, 55] })); return d; }
