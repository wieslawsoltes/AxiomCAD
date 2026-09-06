/** Native WebGPU renderer. The only fallback is a separately identified WebGL2 backend.
 * One interleaved surface batch, one technical-edge batch. GPU buffers persist until geometry changes.
 * On-demand frames; the camera / selection uniform is 128 bytes; no idle render loop.
 */
export const WGSL = `
struct Scene { vp: mat4x4<f32>, eye: vec4<f32>, opts: vec4<f32>, settings: vec4<f32>, ground: vec4<f32> };
@group(0) @binding(0) var<uniform> scene: Scene;
struct Out { @builtin(position) position: vec4<f32>, @location(0) world: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) color: vec3<f32>, @location(3) @interpolate(flat) part: f32, @location(4) material: vec2<f32> };
@vertex fn vs(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) color: vec3<f32>, @location(3) part: f32, @location(4) material: vec2<f32>) -> Out {
 var o: Out; o.position=scene.vp*vec4<f32>(position,1.0); o.world=position; o.normal=normal; o.color=color; o.part=part; o.material=material; return o;
}
fn clipped(p: vec3<f32>, id: f32) -> bool { return scene.opts.z>0.5 && p.z>scene.opts.w && id>0.0; }
@fragment fn fs(i: Out, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
 // Derivatives must be evaluated before non-uniform control flow or discard.
 let gridDeriv=max(fwidth(i.world.xy/10.0),vec2<f32>(0.0001));
 let majorDeriv=max(fwidth(i.world.xy/50.0),vec2<f32>(0.0001));
 if (clipped(i.world,i.part)) { discard; }
 if(i.part<0.0){
  let dark=scene.settings.x; let radius=length(i.world.xy-scene.ground.xy); let fade=1.0-smoothstep(scene.ground.z*0.55,scene.ground.z,radius);
  let coord=i.world.xy/10.0; let deriv=gridDeriv; let g=abs(fract(coord-0.5)-0.5)/deriv; let minor=1.0-min(min(g.x,g.y),1.0);
  let majorCoord=i.world.xy/50.0; let g2=abs(fract(majorCoord-0.5)-0.5)/majorDeriv; let major=1.0-min(min(g2.x,g2.y),1.0);
  let shadow=exp(-pow(length((i.world.xy-scene.ground.xy)/vec2<f32>(scene.ground.w,scene.ground.w*0.65)),2.0)*2.0)*0.15;
  let bg=mix(vec3<f32>(0.936,0.950,0.959),vec3<f32>(0.095,0.126,0.155),dark); let grid=(minor*0.016+major*0.018)*scene.settings.y;
  return vec4<f32>(bg-vec3<f32>(grid+shadow*(1.0-dark*0.6)),fade);
 }
 var n=normalize(i.normal); if(!front){n=-n;}
 let v=normalize(scene.eye.xyz-i.world); let l=normalize(vec3<f32>(-0.5,-0.8,1.65)); let h=normalize(l+v);
 let ndl=max(dot(n,l),0.0); let ndv=max(dot(n,v),0.001); let ndh=max(dot(n,h),0.0); let vdh=max(dot(v,h),0.0);
 let metal=i.material.x; let rough=max(i.material.y,0.18); let alpha=rough*rough; let a2=alpha*alpha;
 let denom=ndh*ndh*(a2-1.0)+1.0; let D=a2/(3.14159265*denom*denom+0.0001);
 let k=(rough+1.0)*(rough+1.0)/8.0; let G=(ndl/(ndl*(1.0-k)+k))*(ndv/(ndv*(1.0-k)+k));
 let base=pow(i.color,vec3<f32>(2.2)); let f0=mix(vec3<f32>(0.04),base,metal); let F=f0+(vec3<f32>(1.0)-f0)*pow(1.0-vdh,5.0);
 let spec=D*G*F/max(4.0*ndl*ndv,0.001); let diffuse=(vec3<f32>(1.0)-F)*(1.0-metal)*base/3.14159265;
 let fill=max(dot(n,normalize(vec3<f32>(1.0,0.6,0.8))),0.0); let hemi=n.z*0.5+0.5;
 var color=(diffuse+spec)*ndl*3.0+base*(0.28+hemi*0.28+fill*0.25)+f0*(pow(1.0-ndv,3.0)*0.35+hemi*0.15);
 color=pow(max(color,vec3<f32>(0.0)),vec3<f32>(1.0/2.2));
 if(i.part==scene.opts.x && scene.opts.x>0.0){color=mix(color,vec3<f32>(0.17,0.66,0.88),0.27);}else if(i.part==scene.opts.y && scene.opts.y>0.0){color=mix(color,vec3<f32>(0.44,0.74,0.86),0.14);}
 if(scene.settings.z>2.5){color=mix(color,vec3<f32>(0.64,0.79,0.88),0.55);return vec4<f32>(color,0.3);}
 return vec4<f32>(color,1.0);
}
@fragment fn edge(i: Out) -> @location(0) vec4<f32> {
 if(clipped(i.world,i.part)){discard;}
 if(i.part<0.0){return vec4<f32>(i.color,1.0);}
 var c=mix(vec3<f32>(0.20,0.29,0.34),vec3<f32>(0.43,0.60,0.69),scene.settings.x);
 if(scene.settings.z>1.5){c=mix(vec3<f32>(0.16,0.31,0.40),vec3<f32>(0.45,0.68,0.80),scene.settings.x);}
 if(i.part==scene.opts.x&&scene.opts.x>0.0){c=vec3<f32>(0.02,0.55,0.80);}
 if(i.part==scene.opts.y&&scene.opts.y>0.0){c=vec3<f32>(0.12,0.53,0.66);}
 return vec4<f32>(c,1.0);
}`;
const GLVERT = `#version 300 es
precision highp float; layout(location=0) in vec3 position;layout(location=1) in vec3 normal;layout(location=2) in vec3 color;layout(location=3) in float part;layout(location=4) in vec2 material;
uniform mat4 vp;out vec3 world;out vec3 nor;out vec3 col;flat out float pid;out vec2 mat;
void main(){gl_Position=vp*vec4(position,1.);gl_Position.z=gl_Position.z*2.-gl_Position.w;world=position;nor=normal;col=color;pid=part;mat=material;}`;
const GLFRAG = `#version 300 es
precision highp float;in vec3 world;in vec3 nor;in vec3 col;flat in float pid;in vec2 mat;uniform vec4 eye;uniform vec4 opts;uniform vec4 settings;uniform vec4 ground;uniform int lines;out vec4 frag;
void main(){if(opts.z>.5&&world.z>opts.w&&pid>0.)discard;
if(lines==1){vec3 c=mix(vec3(.20,.29,.34),vec3(.43,.60,.69),settings.x);if(pid==opts.x&&opts.x>0.)c=vec3(.02,.55,.80);if(pid==opts.y&&opts.y>0.)c=vec3(.12,.53,.66);frag=vec4(pid<0.?col:c,1.);return;}
if(pid<0.){float radius=length(world.xy-ground.xy);float fade=1.-smoothstep(ground.z*.55,ground.z,radius);vec2 coord=world.xy/10.;vec2 g=abs(fract(coord-.5)-.5)/max(fwidth(coord),vec2(.0001));float minor=1.-min(min(g.x,g.y),1.);vec2 c2=world.xy/50.;vec2 g2=abs(fract(c2-.5)-.5)/max(fwidth(c2),vec2(.0001));float major=1.-min(min(g2.x,g2.y),1.);float shadow=exp(-pow(length((world.xy-ground.xy)/vec2(ground.w,ground.w*.65)),2.)*2.)*.15;vec3 bg=mix(vec3(.936,.950,.959),vec3(.095,.126,.155),settings.x);frag=vec4(bg-vec3((minor*.016+major*.018)*settings.y+shadow*(1.-settings.x*.6)),fade);return;}
vec3 n=normalize(nor);if(!gl_FrontFacing)n=-n;vec3 v=normalize(eye.xyz-world),l=normalize(vec3(-.5,-.8,1.65)),h=normalize(l+v);float ndl=max(dot(n,l),0.),ndv=max(dot(n,v),.001),ndh=max(dot(n,h),0.),vdh=max(dot(v,h),0.);float rough=max(mat.y,.18),alpha=rough*rough,a2=alpha*alpha,denom=ndh*ndh*(a2-1.)+1.,D=a2/(3.14159265*denom*denom+.0001),k=(rough+1.)*(rough+1.)/8.,G=(ndl/(ndl*(1.-k)+k))*(ndv/(ndv*(1.-k)+k));vec3 base=pow(col,vec3(2.2)),f0=mix(vec3(.04),base,mat.x),F=f0+(vec3(1.)-f0)*pow(1.-vdh,5.),spec=D*G*F/max(4.*ndl*ndv,.001),diff=(vec3(1.)-F)*(1.-mat.x)*base/3.14159265;float fill=max(dot(n,normalize(vec3(1.,.6,.8))),0.),hemi=n.z*.5+.5;vec3 c=(diff+spec)*ndl*3.+base*(.28+hemi*.28+fill*.25)+f0*(pow(1.-ndv,3.)*.35+hemi*.15);c=pow(max(c,vec3(0.)),vec3(1./2.2));if(pid==opts.x&&opts.x>0.)c=mix(c,vec3(.17,.66,.88),.27);else if(pid==opts.y&&opts.y>0.)c=mix(c,vec3(.44,.74,.86),.14);frag=vec4(settings.z>2.5?mix(c,vec3(.64,.79,.88),.55):c,settings.z>2.5?.3:1.);}`;
export class Renderer {
    static async create(canvas, onLost = () => { }) { let r = new Renderer(canvas); try {
        if (!navigator.gpu)
            throw Error('WebGPU is unavailable in this browser');
        await r.initGPU(onLost);
    }
    catch (e) {
        console.info('Axiom renderer fallback:', e.message);
        r.reason = e.message;
        if (r.device) {
            r.device.destroy();
            r.device = null;
        }
        if (r.context) {
            const next = canvas.cloneNode();
            canvas.replaceWith(next);
            r.canvas = next;
            r.context = null;
            r.depth = null;
            r.msaa = null;
        }
        r.initGL();
    } return r; }
    constructor(canvas) { this.canvas = canvas; this.surfaceCount = 0; this.edgeCount = 0; this.sectionCount = 0; this.data = new Float32Array(32); this.groundData = [0, 0, 650, 85]; this.backend = 'initializing'; this.lastSubmitMs = 0; }
    async initGPU(onLost) { this.adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); if (!this.adapter)
        throw Error('No WebGPU adapter'); this.device = await this.adapter.requestDevice(); this.device.lost.then(info => { if (info.reason !== 'destroyed')
        onLost(info.message); }); this.device.addEventListener('uncapturederror', e => { console.error('WebGPU:', e.error.message); onLost(e.error.message); }); const d = this.device; this.context = this.canvas.getContext('webgpu'); if (!this.context)
        throw Error('WebGPU canvas creation failed'); this.format = navigator.gpu.getPreferredCanvasFormat(); this.context.configure({ device: d, format: this.format, alphaMode: 'premultiplied' }); const module = d.createShaderModule({ label: 'Axiom CAD surface and edge shading', code: WGSL }); const info = await module.getCompilationInfo(); const errs = info.messages.filter(m => m.type === 'error'); if (errs.length)
        throw Error(errs.map(m => m.message).join('; ')); this.uniform = d.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); const bgl = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] }); const layout = d.createPipelineLayout({ bindGroupLayouts: [bgl] }); this.bind = d.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: this.uniform } }] }); const buffers = [{ arrayStride: 48, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x3' }, { shaderLocation: 3, offset: 36, format: 'float32' }, { shaderLocation: 4, offset: 40, format: 'float32x2' }] }]; const blend = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } }; const make = (name, entry, topology, depthWrite = true) => d.createRenderPipelineAsync({ label: name, layout, vertex: { module, entryPoint: 'vs', buffers }, fragment: { module, entryPoint: entry, targets: [{ format: this.format, blend }] }, primitive: { topology, cullMode: 'none' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: depthWrite, depthCompare: 'less-equal', depthBias: topology === 'triangle-list' ? 2 : 0, depthBiasSlopeScale: topology === 'triangle-list' ? 1 : 0 }, multisample: { count: 4 } }); [this.surfacePipeline, this.edgePipeline, this.xrayPipeline] = await Promise.all([make('Opaque CAD surfaces', 'fs', 'triangle-list'), make('Technical model edges', 'edge', 'line-list'), make('Translucent inspection', 'fs', 'triangle-list', false)]); this.backend = 'WebGPU'; this.resize(); }
    initGL() { const gl = this.canvas.getContext('webgl2', { antialias: true, alpha: true, preserveDrawingBuffer: true }); if (!gl)
        throw Error('Neither WebGPU nor WebGL2 is available. Enable hardware acceleration.'); this.gl = gl; const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw Error(gl.getShaderInfoLog(s)); return s; }; const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, GLVERT)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, GLFRAG)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw Error(gl.getProgramInfoLog(p)); this.program = p; this.locations = Object.fromEntries(['vp', 'eye', 'opts', 'settings', 'ground', 'lines'].map(n => [n, gl.getUniformLocation(p, n)])); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); this.backend = 'WebGL2'; this.resize(); }
    resize() { const dpr = Math.min(devicePixelRatio || 1, 2), w = Math.max(1, Math.round(this.canvas.clientWidth * dpr)), h = Math.max(1, Math.round(this.canvas.clientHeight * dpr)); if (w === this.canvas.width && h === this.canvas.height && this.depth)
        return; this.canvas.width = w; this.canvas.height = h; if (this.device) {
        this.depth?.destroy();
        this.msaa?.destroy();
        this.depth = this.device.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
        this.msaa = this.device.createTexture({ size: [w, h], format: this.format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }
    else
        this.gl.viewport(0, 0, w, h); }
    buffer(name, arr) { if (this.device) {
        this[name]?.destroy();
        this[name] = this.device.createBuffer({ label: name, size: Math.max(48, arr.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        if (arr.length)
            this.device.queue.writeBuffer(this[name], 0, arr);
    }
    else {
        const gl = this.gl;
        if (this[name])
            gl.deleteBuffer(this[name]);
        this[name] = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this[name]);
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    } }
    upload(items, bodies, explode = 0, translations = {}) {
        const count = items.reduce((s, m) => s + m.vertices.length / 6, 0);
        let v = new Float32Array((count + 6) * 12), edge = [], at = 0;
        const valid = items.filter(m => !m.error);
        let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (const item of valid)
            for (let k = 0; k < 3; k++) {
                min[k] = Math.min(min[k], item.bounds.min[k]);
                max[k] = Math.max(max[k], item.bounds.max[k]);
            }
        const center = valid.length ? min.map((x, k) => (x + max[k]) / 2) : [0, 0, 0];
        const groundZ = valid.length ? Math.min(-.6, min[2] - .6) : -.6;
        const span = valid.length ? Math.max(max[0] - min[0], max[1] - min[1], 100) : 100;
        this.groundData = [center[0], center[1], Math.max(600, span * 4), span * .55];
        const gg = [[-12000, -12000, groundZ], [12000, -12000, groundZ], [12000, 12000, groundZ], [-12000, -12000, groundZ], [12000, 12000, groundZ], [-12000, 12000, groundZ]];
        for (const p of gg) {
            v.set([...p, 0, 0, 1, .95, .95, .95, -1, 0, .7], at);
            at += 12;
        }
        this.drawItems = [];
        for (const item of valid) {
            const body = bodies.find(b => b.id === item.id), id = bodies.indexOf(body) + 1;
            if (!body)
                continue;
            let rgb = hexRGB(body.color || '#a8b8c5'), material = body.material || 'aluminum', mp = MATERIALS[material] || MATERIALS.aluminum;
            const offset = (body.explode || [0, 0, id * 5]).map((n, k) => n * explode + (translations[body.id]?.[k] || 0));
            const p = item.vertices;
            for (let i = 0; i < p.length; i += 6) {
                v.set([p[i] + offset[0], p[i + 1] + offset[1], p[i + 2] + offset[2], p[i + 3], p[i + 4], p[i + 5], ...rgb, id, mp.metallic, mp.roughness], at);
                at += 12;
            }
            for (let i = 0; i < item.edges.length; i += 3)
                edge.push(item.edges[i] + offset[0], item.edges[i + 1] + offset[1], item.edges[i + 2] + offset[2], 0, 0, 1, ...rgb, id, 0, .7);
            this.drawItems.push({ ...item, offset, index: id, body });
        }
        this.surfaceCount = at / 12;
        this.edgeCount = edge.length / 12;
        this.buffer('surfaceBuffer', v.subarray(0, at));
        this.buffer('edgeBuffer', new Float32Array(edge));
    }
    section(enabled, z) {
        let lines = [];
        if (enabled)
            for (const item of this.drawItems) {
                const p = item.vertices, o = item.offset;
                for (let i = 0; i < p.length; i += 18) {
                    let vs = [0, 6, 12].map(k => [p[i + k] + o[0], p[i + k + 1] + o[1], p[i + k + 2] + o[2]]), hits = [];
                    for (let k = 0; k < 3; k++) {
                        let a = vs[k], b = vs[(k + 1) % 3];
                        if ((a[2] < z && b[2] >= z) || (b[2] < z && a[2] >= z)) {
                            let t = (z - a[2]) / (b[2] - a[2]);
                            hits.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z]);
                        }
                    }
                    if (hits.length === 2)
                        for (const h of hits)
                            lines.push(...h, 0, 0, 1, 1, .57, .09, -2, 0, .7);
                }
            }
        this.sectionCount = lines.length / 12;
        this.buffer('sectionBuffer', new Float32Array(lines));
    }
    render(camera, state) {
        if (!this.surfaceBuffer)
            return;
        const start = performance.now();
        this.resize();
        this.data.set(camera.vp);
        this.data.set([...camera.eye, 1], 16);
        this.data.set([state.selected || 0, state.hover || 0, +state.section, state.sectionZ], 20);
        this.data.set([+state.dark, +state.grid, state.mode, 0], 24);
        this.data.set(this.groundData, 28);
        if (this.device) {
            const d = this.device;
            d.queue.writeBuffer(this.uniform, 0, this.data);
            const enc = d.createCommandEncoder();
            const bg = state.dark ? { r: .095, g: .127, b: .16, a: 1 } : { r: .943, g: .957, b: .968, a: 1 };
            const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.msaa.createView(), resolveTarget: this.context.getCurrentTexture().createView(), clearValue: bg, loadOp: 'clear', storeOp: 'store' }], depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
            pass.setBindGroup(0, this.bind);
            pass.setPipeline(this.surfacePipeline);
            pass.setVertexBuffer(0, this.surfaceBuffer);
            pass.draw(6);
            if (state.mode !== 2) {
                if (state.mode === 3)
                    pass.setPipeline(this.xrayPipeline);
                pass.draw(this.surfaceCount - 6, 1, 6);
            }
            if (state.mode !== 1 && this.edgeCount) {
                pass.setPipeline(this.edgePipeline);
                pass.setVertexBuffer(0, this.edgeBuffer);
                pass.draw(this.edgeCount);
            }
            if (this.sectionCount) {
                pass.setPipeline(this.edgePipeline);
                pass.setVertexBuffer(0, this.sectionBuffer);
                pass.draw(this.sectionCount);
            }
            pass.end();
            d.queue.submit([enc.finish()]);
        }
        else {
            const g = this.gl, l = this.locations;
            g.viewport(0, 0, this.canvas.width, this.canvas.height);
            g.clearColor(...(state.dark ? [.095, .127, .16, 1] : [.943, .957, .968, 1]));
            g.depthMask(true);
            g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
            g.useProgram(this.program);
            g.uniformMatrix4fv(l.vp, false, this.data.subarray(0, 16));
            for (const [name, offset] of [['eye', 16], ['opts', 20], ['settings', 24], ['ground', 28]])
                g.uniform4fv(l[name], this.data.subarray(offset, offset + 4));
            const bind = b => { g.bindBuffer(g.ARRAY_BUFFER, b); for (const [loc, size, offset] of [[0, 3, 0], [1, 3, 12], [2, 3, 24], [3, 1, 36], [4, 2, 40]]) {
                g.enableVertexAttribArray(loc);
                g.vertexAttribPointer(loc, size, g.FLOAT, false, 48, offset);
            } };
            g.uniform1i(l.lines, 0);
            bind(this.surfaceBuffer);
            g.enable(g.POLYGON_OFFSET_FILL);
            g.polygonOffset(1, 2);
            g.drawArrays(g.TRIANGLES, 0, 6);
            if (state.mode !== 2) {
                g.depthMask(state.mode !== 3);
                g.drawArrays(g.TRIANGLES, 6, this.surfaceCount - 6);
            }
            g.disable(g.POLYGON_OFFSET_FILL);
            g.depthMask(true);
            g.uniform1i(l.lines, 1);
            if (state.mode !== 1 && this.edgeCount) {
                bind(this.edgeBuffer);
                g.drawArrays(g.LINES, 0, this.edgeCount);
            }
            if (this.sectionCount) {
                bind(this.sectionBuffer);
                g.drawArrays(g.LINES, 0, this.sectionCount);
            }
        }
        this.lastSubmitMs = performance.now() - start;
    }
    dispose() { if (this.device) {
        for (const k of ['surfaceBuffer', 'edgeBuffer', 'sectionBuffer', 'uniform', 'depth', 'msaa'])
            this[k]?.destroy();
        this.device.destroy();
    }
    else
        this.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
}
export function hexRGB(hex) { let s = hex.replace('#', ''); return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16) / 255); }
export const MATERIALS = { aluminum: { name: 'Aluminum 6061', density: 2.70, metallic: .68, roughness: .34, color: '#b9c7d1' }, steel: { name: 'Stainless steel', density: 7.85, metallic: .88, roughness: .24, color: '#a6b3bc' }, titanium: { name: 'Titanium', density: 4.51, metallic: .78, roughness: .30, color: '#8a9ba6' }, brass: { name: 'Brass', density: 8.50, metallic: .78, roughness: .29, color: '#c5a366' }, blue: { name: 'Anodized aluminum', density: 2.70, metallic: .50, roughness: .31, color: '#347893' }, black: { name: 'Black oxide steel', density: 7.85, metallic: .58, roughness: .34, color: '#4b565e' }, plastic: { name: 'ABS plastic', density: 1.04, metallic: 0, roughness: .58, color: '#d4dadf' }, copper: { name: 'Copper', density: 8.96, metallic: .82, roughness: .28, color: '#bd8567' } };
