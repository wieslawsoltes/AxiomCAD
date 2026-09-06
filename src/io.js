import { K } from './geometry.js';
import { newBody } from './samples.js';
export const LIMITS = { fileBytes: 30 * 1024 * 1024, triangles: 250000, bodies: 512, sketches: 256, points: 2048, features: 64 };
const finite = (n, label, min = -1000000, max = 1000000) => { if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
    throw Error(label + ' must be a finite number between ' + min + ' and ' + max + '.'); return n; };
const text = (s, fallback = 'Untitled') => String(s ?? fallback).replace(/[\u0000-\u001f]/g, '').slice(0, 120) || fallback;
export function validatePoints(points) { if (!Array.isArray(points) || points.length < 3 || points.length > LIMITS.points)
    throw Error('A profile must have 3–' + LIMITS.points + ' vertices.'); for (const p of points) {
    if (!Array.isArray(p) || p.length !== 2)
        throw Error('Profile vertices must be [x, y] pairs.');
    p.forEach(n => finite(n, 'Profile coordinate'));
} K.triangulate(points); return points; }
export function validateShapeParameters(kind, p) {
    if (!p || typeof p !== 'object')
        throw Error('Missing shape parameters.');
    const positive = (key, min = .0001, max = 100000) => finite(p[key], key, min, max);
    switch (kind) {
        case 'box':
            for (const key of ['width', 'depth', 'height'])
                positive(key);
            positive('radius', 0);
            if (p.radius >= Math.min(p.width, p.depth) / 2)
                throw Error('Corner radius must be smaller than half of the shortest side.');
            break;
        case 'cylinder':
            positive('radius');
            positive('height');
            if (p.topRadius !== undefined)
                positive('topRadius', 0);
            if (p.bevel !== undefined) {
                positive('bevel', 0);
                if (p.bevel > Math.min(p.radius * .7, p.height * .4))
                    throw Error('Rim bevel is too large.');
            }
            break;
        case 'tube':
            positive('radius');
            positive('innerRadius');
            positive('height');
            if (p.innerRadius >= p.radius)
                throw Error('Inner radius must be smaller than outer radius.');
            break;
        case 'sphere':
            positive('radius');
            break;
        case 'gear':
            positive('radius');
            positive('height');
            positive('teeth', 6, 128);
            if (!Number.isInteger(p.teeth))
                throw Error('Tooth count must be an integer.');
            positive('bore', 0);
            if (p.bore >= p.radius * .84)
                throw Error('The bore extends into the tooth root.');
            break;
        case 'extrude':
            validatePoints(p.points);
            finite(p.height, 'Extrusion distance');
            if (Math.abs(p.height) < .0001)
                throw Error('Extrusion distance must be nonzero.');
            break;
        case 'revolve':
            validatePoints(p.points);
            if (p.points.some(p => p[0] < 0))
                throw Error('Revolve radii must be nonnegative.');
            finite(p.angle ?? 360, 'Sweep', .1, 360);
            break;
        case 'mesh':
            if (!Array.isArray(p.vertices) || p.vertices.length % 9 || !p.vertices.length || p.vertices.length / 9 > LIMITS.triangles)
                throw Error('A mesh must contain at most 250,000 triangles.');
            for (const n of p.vertices)
                finite(n, 'Vertex coordinate');
            break;
        case 'mirror':
            if (!['X', 'Y', 'Z'].includes(p.axis))
                throw Error('Invalid mirror axis.');
            finite(p.offset, 'Plane offset');
            break;
        case 'boolean':
            if (!['union', 'subtract', 'intersect'].includes(p.operation))
                throw Error('Unsupported Boolean operation.');
            break;
        default: throw Error('Unsupported body type: ' + kind);
    }
    if (p.segments !== undefined && (!Number.isInteger(p.segments) || p.segments < 6 || p.segments > 192))
        throw Error('Segment count must be an integer from 6 to 192.');
    return p;
}
export function validateDocument(input) { if (!input || input.schema !== 'axiom-cad' || input.version !== 1)
    throw Error('This is not an Axiom CAD version 1 document.'); if (!Array.isArray(input.bodies) || input.bodies.length > LIMITS.bodies || !Array.isArray(input.sketches) || input.sketches.length > LIMITS.sketches)
    throw Error('Document body/sketch count exceeds the safety limit.'); const id = s => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(s) ? s : globalThis.crypto.randomUUID(); let total = 0; const body = (b, depth = 0) => { if (!b || depth > 12 || ++total > 2048)
    throw Error('Invalid or excessively nested solid dependency.'); const result = newBody(b.kind, JSON.parse(JSON.stringify(b.params || {})), { id: id(b.id), name: text(b.name, b.kind), visible: b.visible !== false, color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#b9c7d1', material: typeof b.material === 'string' ? b.material : 'aluminum' }); for (const key of ['position', 'rotation', 'scale']) {
    const value = b[key] ?? (key === 'scale' ? [1, 1, 1] : [0, 0, 0]);
    if (!Array.isArray(value) || value.length !== 3)
        throw Error(key + ' must contain three coordinates.');
    result[key] = value.map(n => finite(n, key));
    if (key === 'scale' && result[key].some(n => Math.abs(n) < .000001))
        throw Error('A scale component cannot be zero.');
} if (b.explode) {
    if (!Array.isArray(b.explode) || b.explode.length !== 3)
        throw Error('Invalid exploded-view offset.');
    result.explode = b.explode.map(n => finite(n, 'Exploded-view offset'));
} if (!Array.isArray(b.features || []) || (b.features || []).length > LIMITS.features)
    throw Error('Too many body features.'); result.features = (b.features || []).map(f => { if (!['hole', 'shell'].includes(f.type))
    throw Error('Unsupported feature: ' + f.type); const p = f.params || {}; if (f.type === 'hole') {
    finite(p.radius, 'Hole radius', .001, 100000);
    finite(p.depth, 'Hole depth', .001, 100000);
    if (!['X', 'Y', 'Z'].includes(p.axis))
        throw Error('Invalid drilling axis.');
    for (const a of ['x', 'y', 'z'])
        finite(p[a] || 0, 'Hole ' + a);
    if (p.segments !== undefined && (!Number.isInteger(p.segments) || p.segments < 6 || p.segments > 192))
        throw Error('Invalid hole segment count.');
}
else
    finite(p.thickness, 'Shell thickness', .001, 100000); return { id: id(f.id), type: f.type, name: text(f.name, f.type), params: JSON.parse(JSON.stringify(p)), suppressed: !!f.suppressed }; }); validateShapeParameters(result.kind, result.params); if (result.kind === 'boolean') {
    result.params.a = body(result.params.a, depth + 1);
    result.params.b = body(result.params.b, depth + 1);
} if (result.kind === 'mirror')
    result.params.source = body(result.params.source, depth + 1); return result; }; const bodies = input.bodies.map(b => body(b)); const sketches = input.sketches.map(s => { validatePoints(s.points); if (!['XY', 'XZ', 'YZ'].includes(s.plane))
    throw Error('Invalid sketch plane.'); const origin = s.origin || [0, 0, 0]; if (origin.length !== 3)
    throw Error('Invalid sketch origin.'); return { id: id(s.id), name: text(s.name, 'Sketch'), plane: s.plane, origin: origin.map(n => finite(n, 'Sketch origin')), points: s.points.map(p => p.slice()), visible: !!s.visible, closed: true }; }); const ids = [...bodies, ...sketches].map(x => x.id); if (new Set(ids).size !== ids.length)
    throw Error('Document contains duplicate body or sketch identifiers.'); return { schema: 'axiom-cad', version: 1, name: text(input.name, 'Untitled assembly'), units: 'mm', bodies, sketches }; }
export function parseSTL(buffer) {
    if (buffer.byteLength > LIMITS.fileBytes)
        throw Error('File exceeds the 30 MB import limit.');
    const view = new DataView(buffer);
    let vertices = [];
    if (buffer.byteLength >= 84) {
        const count = view.getUint32(80, true);
        if (count > 0 && 84 + count * 50 <= buffer.byteLength && buffer.byteLength - (84 + count * 50) < 1024) {
            if (count > LIMITS.triangles)
                throw Error('STL exceeds 250,000 triangles.');
            vertices = new Array(count * 9);
            for (let i = 0; i < count; i++)
                for (let j = 0; j < 9; j++)
                    vertices[i * 9 + j] = view.getFloat32(84 + i * 50 + 12 + j * 4, true);
            validateShapeParameters('mesh', { vertices });
            return vertices;
        }
    }
    const source = new TextDecoder().decode(buffer);
    if (!/\bsolid\b/i.test(source))
        throw Error('Unrecognized STL format.');
    const re = /\bvertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
    for (const match of source.matchAll(re)) {
        vertices.push(Number(match[1]), Number(match[2]), Number(match[3]));
        if (vertices.length > LIMITS.triangles * 9)
            throw Error('STL exceeds 250,000 triangles.');
    }
    validateShapeParameters('mesh', { vertices });
    return vertices;
}
export function parseOBJ(source) {
    const vertices = [], out = [];
    for (const raw of source.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#'))
            continue;
        const parts = line.split(/\s+/);
        if (parts[0] === 'v') {
            if (parts.length < 4)
                throw Error('Malformed OBJ vertex.');
            const v = parts.slice(1, 4).map(Number);
            v.forEach(n => finite(n, 'OBJ coordinate'));
            vertices.push(v);
            if (vertices.length > 1000000)
                throw Error('OBJ has too many vertices.');
        }
        else if (parts[0] === 'f') {
            const face = parts.slice(1).map(token => { const n = Number(token.split('/')[0]); if (!Number.isInteger(n) || n === 0)
                throw Error('Invalid OBJ face index.'); const i = n < 0 ? vertices.length + n : n - 1; if (!vertices[i])
                throw Error('OBJ face index is out of range.'); return vertices[i]; });
            if (face.length < 3 || face.length > 2048)
                throw Error('Invalid OBJ face size.');
            if (face.length === 3)
                out.push(...face.flat());
            else {
                const plane = K.poly(face);
                if (!plane)
                    throw Error('Degenerate OBJ face.');
                const normal = plane.n, axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))), axes = [0, 1, 2].filter(x => x !== axis), projected = face.map(v => axes.map(i => v[i])), t = K.triangulate(projected);
                const map = t.ps.map(p => projected.findIndex(q => Math.abs(q[0] - p[0]) < 1e-7 && Math.abs(q[1] - p[1]) < 1e-7));
                const reversed = K.area2(projected) < 0;
                for (const tri of t.ts) {
                    const indices = reversed ? [...tri].reverse() : tri;
                    for (const i of indices)
                        out.push(...face[map[i]]);
                }
            }
            if (out.length / 9 > LIMITS.triangles)
                throw Error('OBJ exceeds 250,000 triangles.');
        }
    }
    validateShapeParameters('mesh', { vertices: out });
    return out;
}
export function binarySTL(items) { const total = items.reduce((n, item) => n + item.vertices.length / 18, 0); if (!total)
    throw Error('There are no visible triangles to export.'); const buffer = new ArrayBuffer(84 + 50 * total), dv = new DataView(buffer); new Uint8Array(buffer, 0, 80).set(new TextEncoder().encode('Axiom CAD | units:mm | polygonal model')); dv.setUint32(80, total, true); let offset = 84; for (const item of items) {
    const p = item.vertices;
    for (let i = 0; i < p.length; i += 18) {
        const a = [p[i], p[i + 1], p[i + 2]], b = [p[i + 6], p[i + 7], p[i + 8]], c = [p[i + 12], p[i + 13], p[i + 14]], u = b.map((v, k) => v - a[k]), v = c.map((x, k) => x - a[k]), n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1;
        for (const f of [...n.map(v => v / l), ...a, ...b, ...c]) {
            dv.setFloat32(offset, f, true);
            offset += 4;
        }
        dv.setUint16(offset, 0, true);
        offset += 2;
    }
} return buffer; }
export function writeOBJ(items, bodies) { let lines = ['# Axiom CAD · units: millimeters', '# Polygonal geometry; visible design bodies, unexploded'], index = 1; const f = n => Number(n.toFixed(6)); for (const item of items) {
    const body = bodies.find(b => b.id === item.id);
    lines.push('o ' + (body?.name || 'Body').replace(/[^\w.-]+/g, '_'));
    const p = item.vertices;
    for (let i = 0; i < p.length; i += 6) {
        lines.push('v ' + [p[i], p[i + 1], p[i + 2]].map(f).join(' '));
        lines.push('vn ' + [p[i + 3], p[i + 4], p[i + 5]].map(f).join(' '));
    }
    for (let i = 0; i < p.length / 6; i += 3) {
        lines.push('f ' + [index + i, index + i + 1, index + i + 2].map(n => n + '//' + n).join(' '));
    }
    index += p.length / 6;
} return lines.join('\n') + '\n'; }
