/** Pure polygonal solid kernel. Millimetres; Z-up. No DOM / GPU dependencies.
 * BSP operations are approximate polygonal CSG, NOT exact analytic B-rep.
 */
export const K = (() => {
    const E = 1e-5, add = (a, b) => a.map((v, i) => v + b[i]), sub = (a, b) => a.map((v, i) => v - b[i]), mul = (a, s) => a.map(v => v * s), dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0), cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = a => { let d = Math.hypot(...a); return d > E ? mul(a, 1 / d) : [0, 0, 0]; };
    const poly = v => { if (v.length < 3)
        return null; let n = [0, 0, 0]; for (let i = 1; i < v.length - 1; i++) {
        n = norm(cross(sub(v[i], v[0]), sub(v[i + 1], v[0])));
        if (Math.hypot(...n) > .5)
            break;
    } if (Math.hypot(...n) < .5)
        return null; return { v, n, w: dot(n, v[0]) }; };
    const clean = p => p.filter(Boolean), rev = p => ({ v: [...p.v].reverse(), n: mul(p.n, -1), w: -p.w });
    function split(p, plane, cpFront, cpBack, front, back) { let types = p.v.map(v => { let t = dot(plane.n, v) - plane.w; return t < -E ? 2 : t > E ? 1 : 0; }), type = types.reduce((s, t) => s | t, 0); if (type === 0)
        (dot(plane.n, p.n) > 0 ? cpFront : cpBack).push(p);
    else if (type === 1)
        front.push(p);
    else if (type === 2)
        back.push(p);
    else {
        let f = [], b = [];
        for (let i = 0; i < p.v.length; i++) {
            let j = (i + 1) % p.v.length, ti = types[i], tj = types[j], vi = p.v[i], vj = p.v[j];
            if (ti !== 2)
                f.push(vi);
            if (ti !== 1)
                b.push(vi);
            if ((ti | tj) === 3) {
                const t = (plane.w - dot(plane.n, vi)) / dot(plane.n, sub(vj, vi)), v = add(vi, mul(sub(vj, vi), t));
                f.push(v);
                b.push(v);
            }
        }
        const pf = poly(f), pb = poly(b);
        if (pf)
            front.push(pf);
        if (pb)
            back.push(pb);
    } }
    class BSP {
        constructor(polys = [], depth = 0) { this.p = []; this.plane = null; this.f = null; this.b = null; if (polys.length)
            this.build(polys, depth); }
        build(ps, depth = 0) { if (!ps.length)
            return; if (depth > 700)
            throw Error('Boolean complexity limit reached. Use lower tessellation or simpler operands.'); if (!this.plane) {
            const p = ps[Math.floor(ps.length / 3)];
            this.plane = { n: p.n, w: p.w };
        } let f = [], b = []; for (const p of ps)
            split(p, this.plane, this.p, this.p, f, b); if (f.length) {
            if (!this.f)
                this.f = new BSP();
            this.f.build(f, depth + 1);
        } if (b.length) {
            if (!this.b)
                this.b = new BSP();
            this.b.build(b, depth + 1);
        } }
        all() { return [...this.p, ...(this.f ? this.f.all() : []), ...(this.b ? this.b.all() : [])]; }
        invert() { this.p = this.p.map(rev); if (this.plane) {
            this.plane = { n: mul(this.plane.n, -1), w: -this.plane.w };
        } if (this.f)
            this.f.invert(); if (this.b)
            this.b.invert(); [this.f, this.b] = [this.b, this.f]; }
        clip(ps) { if (!this.plane)
            return ps.slice(); let f = [], b = []; for (const p of ps)
            split(p, this.plane, f, b, f, b); if (this.f)
            f = this.f.clip(f); b = this.b ? this.b.clip(b) : []; return [...f, ...b]; }
        clipTo(other) { this.p = other.clip(this.p); if (this.f)
            this.f.clipTo(other); if (this.b)
            this.b.clipTo(other); }
    }
    function boolean(a, b, op) { if (!a.length || !b.length) {
        if (op === 'union')
            return a.length ? a : b;
        if (op === 'subtract')
            return a;
        return [];
    } if (a.length + b.length > 22000)
        throw Error('Boolean input exceeds the 22,000-polygon safety limit.'); let A = new BSP(a), B = new BSP(b); if (op === 'subtract') {
        A.invert();
        A.clipTo(B);
        B.clipTo(A);
        B.invert();
        B.clipTo(A);
        B.invert();
        A.build(B.all());
        A.invert();
    }
    else if (op === 'intersect') {
        A.invert();
        B.clipTo(A);
        B.invert();
        A.clipTo(B);
        B.clipTo(A);
        A.build(B.all());
        A.invert();
    }
    else {
        A.clipTo(B);
        B.clipTo(A);
        B.invert();
        B.clipTo(A);
        B.invert();
        A.build(B.all());
    } return A.all(); }
    function area2(ps) { let a = 0; for (let i = 0; i < ps.length; i++) {
        let j = (i + 1) % ps.length;
        a += ps[i][0] * ps[j][1] - ps[j][0] * ps[i][1];
    } return a * .5; }
    function triangulate(points) { let ps = points.map(p => p.slice(0, 2)); if (ps.length > 1 && Math.hypot(ps[0][0] - ps.at(-1)[0], ps[0][1] - ps.at(-1)[1]) < E)
        ps.pop(); if (ps.length < 3 || Math.abs(area2(ps)) < E)
        throw Error('A closed, non-zero-area profile is required.'); if (area2(ps) < 0)
        ps.reverse(); const ids = ps.map((_, i) => i), ts = []; let safety = ps.length * ps.length; const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); while (ids.length > 3 && safety-- > 0) {
        let found = false;
        for (let i = 0; i < ids.length; i++) {
            let a = ids[(i + ids.length - 1) % ids.length], b = ids[i], c = ids[(i + 1) % ids.length];
            if (turn(ps[a], ps[b], ps[c]) <= E)
                continue;
            let contains = ids.some(k => k !== a && k !== b && k !== c && turn(ps[a], ps[b], ps[k]) >= -E && turn(ps[b], ps[c], ps[k]) >= -E && turn(ps[c], ps[a], ps[k]) >= -E);
            if (contains)
                continue;
            ts.push([a, b, c]);
            ids.splice(i, 1);
            found = true;
            break;
        }
        if (!found)
            throw Error('The sketch profile self-intersects or contains overlapping edges.');
    } if (ids.length === 3)
        ts.push(ids.slice()); return { ps, ts }; }
    function extrude(points, height) { const { ps, ts } = triangulate(points), z0 = Math.min(0, height), z1 = Math.max(0, height), out = []; for (const t of ts) {
        out.push(poly(t.map(i => [...ps[i], z1])));
        out.push(poly([...t].reverse().map(i => [...ps[i], z0])));
    } for (let i = 0; i < ps.length; i++) {
        let j = (i + 1) % ps.length;
        out.push(poly([[...ps[i], z0], [...ps[j], z0], [...ps[j], z1], [...ps[i], z1]]));
    } return clean(out); }
    function roundedRect(w, d, r = 0, segments = 10) { r = Math.max(0, Math.min(r, w / 2 - .001, d / 2 - .001)); if (r < E)
        return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]; let p = []; for (let k = 0; k < 4; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 2, c = [[w / 2 - r, -d / 2 + r], [w / 2 - r, d / 2 - r], [-w / 2 + r, d / 2 - r], [-w / 2 + r, -d / 2 + r]][k];
        for (let i = 0; i <= segments; i++) {
            const t = a + i * Math.PI / (2 * segments);
            p.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
        }
    } return p; }
    function lathe(profile, segments = 80, angle = 360) { let pr = profile.map(p => p.slice()); if (area2(pr) < 0)
        pr.reverse(); let out = [], sweep = angle * Math.PI / 180; for (let i = 0; i < segments; i++) {
        const a = i * sweep / segments, b = (i + 1) * sweep / segments, at = (p, t) => [p[0] * Math.cos(t), p[0] * Math.sin(t), p[1]];
        for (let j = 0; j < pr.length; j++) {
            let k = (j + 1) % pr.length;
            const q = [at(pr[j], a), at(pr[j], b), at(pr[k], b), at(pr[k], a)];
            let filtered = q.filter((p, i) => !i || Math.hypot(...sub(p, q[i - 1])) > E);
            if (filtered.length > 2 && Math.hypot(...sub(filtered[0], filtered.at(-1))) < E)
                filtered.pop();
            out.push(poly(filtered));
        }
    } if (angle < 359.999) {
        const { ps, ts } = triangulate(pr);
        for (const t of ts) {
            out.push(poly(t.map(i => [ps[i][0], 0, ps[i][1]])));
            out.push(poly([...t].reverse().map(i => [ps[i][0] * Math.cos(sweep), ps[i][0] * Math.sin(sweep), ps[i][1]])));
        }
    } return clean(out); }
    function cylinder(r, h, segments = 80, r2 = r, bevel = 0) { let b = Math.max(0, Math.min(bevel, r * .7, h * .4)); return lathe(b > 0 ? [[0, 0], [r - b, 0], [r, b], [r2, h - b], [Math.max(.01, r2 - b), h], [0, h]] : [[0, 0], [r, 0], [r2, h], [0, h]], segments); }
    function sphere(r, segments = 48, rings = 24) { let out = []; const p = (a, b) => [r * Math.sin(b) * Math.cos(a), r * Math.sin(b) * Math.sin(a), r * Math.cos(b) + r]; for (let j = 0; j < rings; j++)
        for (let i = 0; i < segments; i++) {
            const a = i * 2 * Math.PI / segments, b = (i + 1) * 2 * Math.PI / segments, t = j * Math.PI / rings, u = (j + 1) * Math.PI / rings;
            out.push(poly([p(a, t), p(a, u), p(b, u)]));
            out.push(poly([p(a, t), p(b, u), p(b, t)]));
        } return clean(out); }
    function transform(ps, body) { const p = body.position || [0, 0, 0], s = body.scale || [1, 1, 1], r = (body.rotation || [0, 0, 0]).map(a => a * Math.PI / 180), cx = Math.cos(r[0]), sx = Math.sin(r[0]), cy = Math.cos(r[1]), sy = Math.sin(r[1]), cz = Math.cos(r[2]), sz = Math.sin(r[2]); const apply = v => { let [x, y, z] = v.map((n, i) => n * s[i]); [y, z] = [y * cx - z * sx, y * sx + z * cx]; [x, z] = [x * cy + z * sy, -x * sy + z * cy]; [x, y] = [x * cz - y * sz, x * sz + y * cz]; return [x + p[0], y + p[1], z + p[2]]; }; const negative = s[0] * s[1] * s[2] < 0; return clean(ps.map(q => poly((negative ? [...q.v].reverse() : q.v).map(apply)))); }
    function shape(kind, p) { switch (kind) {
        case 'box': return extrude(roundedRect(p.width, p.depth, p.radius || 0), p.height);
        case 'cylinder': return cylinder(p.radius, p.height, p.segments || 80, p.topRadius ?? p.radius, p.bevel || 0);
        case 'tube': {
            if (p.innerRadius >= p.radius)
                throw Error('Inner radius must be smaller than outer radius.');
            return lathe([[p.innerRadius, 0], [p.radius, 0], [p.radius, p.height], [p.innerRadius, p.height]], p.segments || 96);
        }
        case 'sphere': return sphere(p.radius);
        case 'gear': {
            let points = [], teeth = Math.round(p.teeth);
            for (let i = 0; i < teeth; i++)
                for (let j = 0; j < 4; j++) {
                    let a = (i + j / 4) * 2 * Math.PI / teeth, r = p.radius * (j === 0 || j === 3 ? .86 : 1);
                    points.push([r * Math.cos(a), r * Math.sin(a)]);
                }
            let out = extrude(points, p.height);
            return p.bore > 0 ? boolean(out, transform(cylinder(p.bore, p.height + 2, 64), { position: [0, 0, -1] }), 'subtract') : out;
        }
        case 'extrude': return extrude(p.points, p.height);
        case 'revolve': return lathe(p.points, p.segments || 80, p.angle || 360);
        case 'mesh': {
            let out = [];
            for (let i = 0; i < p.vertices.length; i += 9)
                out.push(poly([p.vertices.slice(i, i + 3), p.vertices.slice(i + 3, i + 6), p.vertices.slice(i + 6, i + 9)]));
            return clean(out);
        }
        default: throw Error('Unsupported solid type: ' + kind);
    } }
    const cache = new Map();
    function buildBody(body, world = true, depth = 0) { if (depth > 12)
        throw Error('The Boolean dependency tree is too deep.'); const signature = JSON.stringify([body.kind, body.params, body.features]); let out = cache.get(signature); if (!out) {
        if (body.kind === 'mirror') {
            const axis = ['X', 'Y', 'Z'].indexOf(body.params.axis), scale = [1, 1, 1], position = [0, 0, 0];
            scale[axis] = -1;
            position[axis] = body.params.offset * 2;
            out = transform(buildBody(body.params.source, true, depth + 1), { scale, position });
        }
        else if (body.kind === 'boolean') {
            const a = buildBody(body.params.a, true, depth + 1), b = buildBody(body.params.b, true, depth + 1);
            out = boolean(a, b, body.params.operation);
        }
        else
            out = shape(body.kind, body.params);
        for (const f of body.features || []) {
            if (f.suppressed)
                continue;
            if (f.type === 'hole') {
                const p = f.params;
                let cutter = cylinder(p.radius, p.depth || 2000, p.segments || 64);
                const rotation = p.axis === 'X' ? [0, 90, 0] : p.axis === 'Y' ? [-90, 0, 0] : [0, 0, 0];
                cutter = transform(cutter, { position: [p.x || 0, p.y || 0, p.z || 0], rotation });
                out = boolean(out, cutter, 'subtract');
            }
            else if (f.type === 'shell') {
                if (body.kind !== 'box')
                    throw Error('Open shell is supported on box bodies.');
                const p = body.params, t = f.params.thickness;
                if (t * 2 >= Math.min(p.width, p.depth) || t >= p.height)
                    throw Error('Shell thickness exceeds the body size.');
                out = boolean(out, transform(extrude(roundedRect(p.width - 2 * t, p.depth - 2 * t, Math.max(0, (p.radius || 0) - t)), p.height), { position: [0, 0, t] }), 'subtract');
            }
        }
        if (!out.length)
            throw Error('The operation produced an empty solid.');
        if (out.length > 180000)
            throw Error('Generated mesh exceeds the polygon limit.');
        cache.set(signature, out);
        if (cache.size > 100)
            cache.delete(cache.keys().next().value);
    } return world ? transform(out, body) : out; }
    function packed(ps) {
        let faces = [], edgeMap = new Map(), smooth = new Map(), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], volume = 0, area = 0;
        const key = p => p.map(v => Math.round(v * 1e4)).join(',');
        for (const p of ps) {
            for (let i = 1; i < p.v.length - 1; i++) {
                const a = p.v[0], b = p.v[i], c = p.v[i + 1], cr = cross(sub(b, a), sub(c, a)), ar = Math.hypot(...cr) * .5;
                if (ar < E * E)
                    continue;
                faces.push({ v: [a, b, c], n: p.n });
                volume += dot(a, cross(b, c)) / 6;
                area += ar;
                for (const v of [a, b, c]) {
                    for (let j = 0; j < 3; j++) {
                        min[j] = Math.min(min[j], v[j]);
                        max[j] = Math.max(max[j], v[j]);
                    }
                    const k = key(v);
                    if (!smooth.has(k))
                        smooth.set(k, []);
                    const list = smooth.get(k);
                    if (!list.some(n => dot(n, p.n) > .99999))
                        list.push(p.n);
                }
            }
            for (let i = 0; i < p.v.length; i++) {
                const a = p.v[i], b = p.v[(i + 1) % p.v.length], ka = key(a), kb = key(b);
                if (ka === kb)
                    continue;
                const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
                if (!edgeMap.has(k))
                    edgeMap.set(k, { a, b, ns: [] });
                edgeMap.get(k).ns.push(p.n);
            }
        }
        const vertices = new Float32Array(faces.length * 18);
        let vi = 0;
        for (const f of faces)
            for (const v of f.v) {
                let ns = smooth.get(key(v)).filter(n => dot(n, f.n) > .82), n = norm(ns.reduce((a, b) => add(a, b), [0, 0, 0]));
                vertices.set([...v, ...n], vi);
                vi += 6;
            } // A BSP cut can split one side of a coplanar edge but not its neighbor.
        // Sweep collinear intervals instead of treating unmatched T-junctions as creases.
        const lines = new Map();
        for (const e of edgeMap.values()) {
            let d = norm(sub(e.b, e.a));
            const first = d.find(x => Math.abs(x) > 1e-7);
            if (first < 0)
                d = mul(d, -1);
            const moment = cross(e.a, d), k = [...d.map(x => Math.round(x * 1e5)), ...moment.map(x => Math.round(x * 1e3))].join(',');
            let g = lines.get(k);
            if (!g) {
                g = { d, origin: sub(e.a, mul(d, dot(e.a, d))), segments: [] };
                lines.set(k, g);
            }
            let a = dot(e.a, g.d), b = dot(e.b, g.d);
            if (a > b)
                [a, b] = [b, a];
            if (b - a > E)
                g.segments.push({ a, b, ns: e.ns });
        }
        let edge = [];
        for (const g of lines.values()) {
            const events = [];
            g.segments.forEach((s, i) => { events.push({ t: s.a, i, add: true }, { t: s.b, i, add: false }); });
            events.sort((a, b) => a.t - b.t);
            const active = new Set();
            let last = null, pending = null;
            const flush = () => { if (pending) {
                edge.push(...add(g.origin, mul(g.d, pending[0])), ...add(g.origin, mul(g.d, pending[1])));
                pending = null;
            } };
            for (let i = 0; i < events.length;) {
                const t = events[i].t;
                if (last !== null && t - last > E) {
                    const normals = [...active].flatMap(j => g.segments[j].ns);
                    const crease = normals.length === 1 || normals.some(n => dot(n, normals[0]) < .82);
                    if (crease) {
                        if (pending && Math.abs(pending[1] - last) < E * 2)
                            pending[1] = t;
                        else {
                            flush();
                            pending = [last, t];
                        }
                    }
                    else
                        flush();
                }
                while (i < events.length && Math.abs(events[i].t - t) < E) {
                    const e = events[i++];
                    if (e.add)
                        active.add(e.i);
                    else
                        active.delete(e.i);
                }
                last = t;
            }
            flush();
        }
        return { vertices, edges: new Float32Array(edge), bounds: { min, max }, volume: Math.abs(volume), area, triangleCount: faces.length };
    }
    function buildScene(bodies) { return bodies.filter(b => b.visible !== false).map(body => { try {
        return { id: body.id, ...packed(buildBody(body)) };
    }
    catch (e) {
        return { id: body.id, error: e.message };
    } }); }
    return { poly, boolean, triangulate, extrude, roundedRect, lathe, cylinder, sphere, transform, shape, buildBody, packed, buildScene, area2 };
})();
