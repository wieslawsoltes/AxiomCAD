/** CPU transforms remain float64; only GPU uniform uploads narrow to float32.
 * Column-major matrices, right-handed coordinates, Z-up, zero-to-one depth. */
export const V = {
    add: (a, b) => a.map((v, i) => v + b[i]), sub: (a, b) => a.map((v, i) => v - b[i]),
    mul: (a, s) => a.map(v => v * s), dot: (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: a => Math.hypot(...a), norm: a => { const l = Math.hypot(...a); return l > 1e-12 ? a.map(v => v / l) : [0, 0, 0]; },
    lerp: (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
};
export const M = {
    identity: () => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    mul(a, b) { const o = new Float64Array(16); for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++)
            for (let k = 0; k < 4; k++)
                o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; },
    lookAt(eye, at, up = [0, 0, 1]) { let z = V.norm(V.sub(eye, at)), x = V.norm(V.cross(up, z)); if (V.len(x) < .01)
        x = [1, 0, 0]; const y = V.cross(z, x); return new Float64Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -V.dot(x, eye), -V.dot(y, eye), -V.dot(z, eye), 1]); },
    ortho(l, r, b, t, n, f) { return new Float64Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, 1 / (n - f), 0, (l + r) / (l - r), (t + b) / (b - t), n / (n - f), 1]); },
    perspective(fov, a, n, f) { const q = 1 / Math.tan(fov / 2); return new Float64Array([q / a, 0, 0, 0, 0, q, 0, 0, 0, 0, f / (n - f), -1, 0, 0, f * n / (n - f), 0]); },
    invert(a) { let rows = Array.from({ length: 4 }, (_, r) => [...Array.from({ length: 4 }, (_, c) => a[c * 4 + r]), ...Array.from({ length: 4 }, (_, c) => +(r === c))]); for (let i = 0; i < 4; i++) {
        let p = i;
        for (let r = i + 1; r < 4; r++)
            if (Math.abs(rows[r][i]) > Math.abs(rows[p][i]))
                p = r;
        [rows[i], rows[p]] = [rows[p], rows[i]];
        let d = rows[i][i];
        if (Math.abs(d) < 1e-12)
            throw Error('Singular camera matrix');
        rows[i] = rows[i].map(v => v / d);
        for (let r = 0; r < 4; r++)
            if (r !== i) {
                let s = rows[r][i];
                rows[r] = rows[r].map((v, c) => v - s * rows[i][c]);
            }
    } return new Float64Array(Array.from({ length: 16 }, (_, i) => rows[i % 4][4 + Math.floor(i / 4)])); },
    point(m, p) { const a = [...p, 1], r = Array.from({ length: 4 }, (_, i) => a.reduce((s, v, j) => s + m[j * 4 + i] * v, 0)); return r.slice(0, 3).map(v => v / r[3]); }
};
export class Camera {
    constructor() { this.target = [0, 0, 26]; this.yaw = -.92; this.pitch = .53; this.span = 238; this.perspective = false; this.width = 100; this.height = 100; this.update(); }
    update() { let d = this.span * 2.6; this.eye = V.add(this.target, [d * Math.cos(this.pitch) * Math.cos(this.yaw), d * Math.cos(this.pitch) * Math.sin(this.yaw), d * Math.sin(this.pitch)]); this.view = M.lookAt(this.eye, this.target); let a = this.width / this.height; this.proj = this.perspective ? M.perspective(2 * Math.atan(.5 / 2.6), a, .1, 200000) : M.ortho(-this.span * a / 2, this.span * a / 2, -this.span / 2, this.span / 2, .1, 200000); this.vp = M.mul(this.proj, this.view); this.inv = M.invert(this.vp); this.right = [this.view[0], this.view[4], this.view[8]]; this.up = [this.view[1], this.view[5], this.view[9]]; }
    orbit(dx, dy) { this.yaw -= dx * .007; this.pitch = Math.max(-1.569, Math.min(1.569, this.pitch + dy * .007)); this.update(); }
    pan(dx, dy) { this.target = V.add(this.target, V.add(V.mul(this.right, -dx * this.span / this.height), V.mul(this.up, dy * this.span / this.height))); this.update(); }
    zoom(delta, x = this.width / 2, y = this.height / 2) { const a = this.onPlane(x, y, this.target, V.norm(V.sub(this.eye, this.target))); this.span = Math.max(.5, Math.min(40000, this.span * Math.exp(delta * .001))); this.update(); const b = this.onPlane(x, y, this.target, V.norm(V.sub(this.eye, this.target))); if (a && b)
        this.target = V.add(this.target, V.sub(a, b)); this.update(); }
    ray(x, y) { const p = [x / this.width * 2 - 1, 1 - y / this.height * 2]; const a = M.point(this.inv, [...p, 0]), b = M.point(this.inv, [...p, 1]); return { o: a, d: V.norm(V.sub(b, a)) }; }
    onPlane(x, y, origin = [0, 0, 0], normal = [0, 0, 1]) { const r = this.ray(x, y), k = V.dot(r.d, normal); if (Math.abs(k) < 1e-8)
        return null; return V.add(r.o, V.mul(r.d, V.dot(V.sub(origin, r.o), normal) / k)); }
    project(p) { const v = M.point(this.vp, p); return [(v[0] + 1) * this.width / 2, (1 - v[1]) * this.height / 2, v[2]]; }
    preset(name) { const views = { iso: [-.92, .53], front: [-Math.PI / 2, 0], back: [Math.PI / 2, 0], right: [0, 0], left: [Math.PI, 0], top: [-Math.PI / 2, 1.569], bottom: [-Math.PI / 2, -1.569] }; [this.yaw, this.pitch] = views[name] || views.iso; this.update(); }
    fit(bounds) { if (!bounds)
        return; this.target = V.mul(V.add(bounds.min, bounds.max), .5); const size = V.sub(bounds.max, bounds.min); this.span = Math.max(35, V.len(size) * .95, Math.max(...size) * this.height / this.width * 1.4); this.update(); }
}
export function rayTriangle(o, d, a, b, c) { const e1 = V.sub(b, a), e2 = V.sub(c, a), p = V.cross(d, e2), det = V.dot(e1, p); if (Math.abs(det) < 1e-9)
    return null; const s = V.sub(o, a), u = V.dot(s, p) / det; if (u < 0 || u > 1)
    return null; const q = V.cross(s, e1), v = V.dot(d, q) / det; if (v < 0 || u + v > 1)
    return null; const t = V.dot(e2, q) / det; return t > 1e-5 ? { t, point: V.add(o, V.mul(d, t)), normal: V.norm(V.cross(e1, e2)) } : null; }
export function rayBounds(o, d, b) { let lo = 0, hi = Infinity; for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) {
        if (o[i] < b.min[i] || o[i] > b.max[i])
            return false;
        continue;
    }
    let a = (b.min[i] - o[i]) / d[i], c = (b.max[i] - o[i]) / d[i];
    if (a > c)
        [a, c] = [c, a];
    lo = Math.max(lo, a);
    hi = Math.min(hi, c);
    if (hi < lo)
        return false;
} return true; }
