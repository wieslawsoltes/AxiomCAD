import { V, M, Camera, rayTriangle, rayBounds } from './math.js';
import { K } from './geometry.js';
import { Renderer, MATERIALS } from './renderer.js';
import { newBody, blankDocument, bearingSample, gearboxSample } from './samples.js';
import { icon } from './icons.js';
import { LIMITS, validatePoints, validateShapeParameters, validateDocument, parseSTL, parseOBJ, binarySTL, writeOBJ } from './io.js';
const $ = (s, root = document) => root.querySelector(s), $$ = (s, root = document) => [...root.querySelectorAll(s)];
const clone = x => JSON.parse(JSON.stringify(x));
const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => crypto.randomUUID?.() || Math.random().toString(36).slice(2);
const localGet = (k, fallback) => { try {
    return localStorage.getItem(k) ?? fallback;
}
catch {
    return fallback;
} };
let doc = bearingSample();
let restored = false;
try {
    const stored = localGet('axiom-cad:document', '');
    if (stored) {
        doc = validateDocument(JSON.parse(stored));
        restored = true;
    }
}
catch (e) {
    console.info('Ignored invalid local document:', e.message);
}
let renderer, worker, meshes = [], revision = 0, builtRevision = -1, buildTimer, saveTimer, workerTimeout, raf = 0, treeTab = 'model', history = [], undoStack = [], redoStack = [], frameCount = 0;
const camera = new Camera();
const state = { tab: 'Home', selected: [], selectedSketch: null, hover: null, lastPick: null, tool: 'select', sketchTool: 'rect', sketchPlane: 'XY', sketchDraft: null, sketchPolygon: [], sketchCursor: null, sketchDrag: null, planeOffset: 0, grid: true, mode: 0, section: false, sectionZ: 48, explode: 0, dark: localGet('axiom-cad:theme', 'light') === 'dark', dimensions: false, snap: true, snapSize: 1, displayUnits: 'mm', expanded: new Set(), filter: '', building: false, buildError: '', buildMs: 0, previewOffsets: {}, measurement: [], dirty: false, fitNext: !restored, planesExpanded: false, bodiesExpanded: true, sketchesExpanded: true };
if (state.dark)
    document.documentElement.dataset.theme = 'dark';
if (innerWidth <= 1050)
    $('#properties').classList.add('auto-hide');
const scaleFactor = () => state.displayUnits === 'in' ? 25.4 : 1;
const number = (v, d = 2) => Number.isFinite(v) ? (Math.abs(v) < 1e-7 ? 0 : v).toLocaleString('en-US', { maximumFractionDigits: d }) : '—';
const length = (v, d = 2) => number(v / scaleFactor(), d) + ' ' + state.displayUnits;
const val = (v, d = 3) => Number((v / scaleFactor()).toFixed(d));
const selectedBody = () => doc.bodies.find(b => b.id === state.selected[0]);
const meshFor = id => meshes.find(m => m.id === id);
const selectedSketch = () => doc.sketches.find(s => s.id === state.selectedSketch);
const meshBounds = (ms = meshes) => { const valid = ms.filter(m => !m.error); if (!valid.length)
    return null; return { min: [0, 1, 2].map(k => Math.min(...valid.map(m => m.bounds.min[k]))), max: [0, 1, 2].map(k => Math.max(...valid.map(m => m.bounds.max[k]))) }; };
const massOf = (m, b) => m.volume * (MATERIALS[b.material]?.density || 2.7) / 1000;
const massText = g => g > 1000 ? number(g / 1000, 3) + ' kg' : number(g, 1) + ' g';
const commands = {
    select: { label: 'Select', icon: 'select', hint: 'Pick bodies; Shift-click for multiple selection', key: 'V' },
    sketch: { label: 'Create sketch', icon: 'sketch', hint: 'Draw a dimensioned profile on a reference plane', key: 'S' },
    box: { label: 'Box', icon: 'box', hint: 'Create a parametric rectangular solid' },
    cylinder: { label: 'Cylinder', icon: 'cylinder', hint: 'Create a cylinder or a conical frustum' },
    tube: { label: 'Tube', icon: 'tube', hint: 'Create a hollow cylindrical solid' },
    sphere: { label: 'Sphere', icon: 'sphere', hint: 'Create a parametric sphere' },
    gear: { label: 'Spur gear', icon: 'gear', hint: 'Create a stylized gear with a bore; not an involute production gear' },
    extrude: { label: 'Extrude', icon: 'extrude', hint: 'Extrude the selected closed sketch', key: 'E' },
    revolve: { label: 'Revolve', icon: 'revolve', hint: 'Revolve an R–Z profile around the Z axis' },
    hole: { label: 'Hole', icon: 'hole', hint: 'Subtract a cylindrical bore from the selected body', key: 'H' },
    shell: { label: 'Shell', icon: 'shell', hint: 'Hollow a box with an open top' },
    round: { label: 'Round corners', icon: 'fillet', hint: 'Round the vertical corners of a parametric box' },
    chamfer: { label: 'Chamfer', icon: 'fillet', hint: 'Bevel the top and bottom rims of a cylinder' },
    move: { label: 'Move', icon: 'move', hint: 'Move selected bodies using the steering axes', key: 'M' },
    rotate: { label: 'Rotate', icon: 'rotate', hint: 'Set local X, Y and Z rotation angles' },
    scale: { label: 'Scale', icon: 'scale', hint: 'Scale selected bodies' },
    duplicate: { label: 'Duplicate', icon: 'cube', hint: 'Create independent copies of selected bodies', key: '⌘ D' },
    delete: { label: 'Delete', icon: 'trash', hint: 'Remove the selected bodies or sketch', key: '⌫' },
    union: { label: 'Unite', icon: 'union', hint: 'Combine exactly two selected bodies with mesh CSG' },
    subtract: { label: 'Subtract', icon: 'subtract', hint: 'Cut the second selected body from the first' },
    intersect: { label: 'Intersect', icon: 'intersect', hint: 'Keep the common volume of two selected bodies' },
    linear: { label: 'Linear pattern', icon: 'pattern', hint: 'Create regularly spaced copies' },
    circular: { label: 'Circular pattern', icon: 'radial', hint: 'Pattern a body around a world-Z axis' },
    mirror: { label: 'Mirror', icon: 'mirror', hint: 'Reflect a body across a world reference plane' },
    explode: { label: 'Exploded view', icon: 'explode', hint: 'Separate assembly bodies without changing design coordinates' },
    measure: { label: 'Measure', icon: 'ruler', hint: 'Pick two surface points to measure their 3D distance', key: 'D' },
    dimensions: { label: 'Show dimensions', icon: 'dimension', hint: 'Display the selected body’s world-aligned bounding dimensions' },
    section: { label: 'Section view', icon: 'section', hint: 'Inspect with a movable horizontal clipping plane (uncapped)', key: 'C' },
    mass: { label: 'Mass properties', icon: 'info', hint: 'Compute approximate mesh volume, surface area and material mass' },
    fit: { label: 'Fit all', icon: 'fit', hint: 'Fit visible bodies to the viewport', key: 'F' },
    'fit-selection': { label: 'Fit selection', icon: 'fit', hint: 'Frame the selected bodies' },
    iso: { label: 'Isometric view', icon: 'cube', hint: 'Restore the default engineering view', key: '0' },
    top: { label: 'Top view', icon: 'plane', hint: 'Look down the world Z axis', key: '2' },
    front: { label: 'Front view', icon: 'cube', hint: 'Look along world Y', key: '1' },
    right: { label: 'Right view', icon: 'cube', hint: 'Look along world X', key: '3' },
    back: { label: 'Back view', icon: 'cube', hint: 'Rear orthographic orientation' },
    left: { label: 'Left view', icon: 'cube', hint: 'Left orthographic orientation' },
    bottom: { label: 'Bottom view', icon: 'plane', hint: 'Look up the world Z axis' },
    perspective: { label: 'Perspective', icon: 'orbit', hint: 'Toggle perspective and orthographic projection' },
    grid: { label: 'Ground grid', icon: 'grid', hint: 'Toggle the world-space reference grid', key: 'G' },
    'shaded-edges': { label: 'Shaded + edges', icon: 'cube', hint: 'Lit surfaces with technical feature edges' },
    shaded: { label: 'Shaded', icon: 'sphere', hint: 'Lit surfaces without edge lines' },
    wireframe: { label: 'Wireframe', icon: 'mesh', hint: 'Show technical edges only', key: 'W' },
    xray: { label: 'X-ray', icon: 'eye', hint: 'Translucent surfaces for approximate visual inspection' },
    theme: { label: 'Toggle theme', icon: 'moon', hint: 'Switch between light and dark workspaces' },
    new: { label: 'New document', icon: 'new', hint: 'Start an empty mechanical design' },
    open: { label: 'Open / import', icon: 'open', hint: 'Read Axiom JSON, STL or OBJ files', key: '⌘ O' },
    save: { label: 'Save document', icon: 'save', hint: 'Download a native Axiom JSON file', key: '⌘ S' },
    export: { label: 'Export', icon: 'export', hint: 'Export STL, OBJ, SVG, PNG or a native document' },
    snapshot: { label: 'Save image', icon: 'camera', hint: 'Export the current 3D viewport to PNG' },
    undo: { label: 'Undo', icon: 'undo', hint: 'Undo the last document edit', key: '⌘ Z' },
    redo: { label: 'Redo', icon: 'redo', hint: 'Redo the last undone edit', key: '⇧ ⌘ Z' },
    rect: { label: 'Rectangle', icon: 'rect', hint: 'Drag two corners on the active sketch plane', key: 'R' },
    circle: { label: 'Circle', icon: 'circle', hint: 'Drag from a center point to the radius' },
    polygon: { label: 'Polyline', icon: 'polygon', hint: 'Click vertices; Enter or click the first point to close', key: 'P' },
    'finish-sketch': { label: 'Finish sketch', icon: 'check', hint: 'Finish editing the current sketch' },
    'sketch-size': { label: 'Sketch dimensions', icon: 'dimension', hint: 'Edit the width and height of the selected profile' },
    'sample-bearing': { label: 'Bearing support sample', icon: 'cube', hint: 'Open the fully editable mechanical assembly' },
    'sample-gears': { label: 'Gear pair sample', icon: 'gear', hint: 'Open a stylized gear mechanism' },
    'show-all': { label: 'Show all bodies', icon: 'eye', hint: 'Restore visibility for all bodies' },
    isolate: { label: 'Isolate selection', icon: 'eye', hint: 'Hide bodies outside the current selection' },
    visibility: { label: 'Hide selection', icon: 'eyeoff', hint: 'Toggle selected body visibility', key: 'Space' },
    help: { label: 'Keyboard shortcuts', icon: 'help', hint: 'View navigation, modeling and file controls', key: '?' },
    about: { label: 'About Axiom CAD', icon: 'info', hint: 'Implementation details, supported formats and limits' },
    search: { label: 'Find a command', icon: 'search', hint: 'Search every available command', key: '⌘ K' },
    units: { label: 'Display units', icon: 'ruler', hint: 'Display millimeters or inches; the document stores millimeters' },
    snap: { label: 'Toggle snapping', icon: 'grid', hint: 'Snap sketch points and translations to a 1 mm grid' },
    'toggle-properties': { label: 'Design properties', icon: 'panel', hint: 'Show or hide the inspector' },
    'collapse-tree': { label: 'Collapse feature tree', icon: 'settings', hint: 'Collapse all expanded feature groups' },
    file: { label: 'File menu', icon: 'folder', hint: 'Create, open, save or export a document' }
};
const tabGroups = {
    Home: [['Selection', ['select']], ['Create', ['sketch', ['box', 'cylinder', 'tube'], ['sphere', 'gear']]], ['Features', ['extrude', 'revolve', 'hole', 'shell', 'round']], ['Modify', [['move', 'rotate', 'scale']]], ['Boolean', [['union', 'subtract', 'intersect']]], ['Pattern', [['linear', 'circular', 'mirror']]], ['Inspect', ['measure']]],
    Sketch: [['Draw', ['rect', 'circle', 'polygon']], ['Profile', ['sketch-size', ['snap', 'grid']]], ['Solid features', ['extrude', 'revolve']], ['Manage', [['delete', 'undo', 'redo']]], ['Finish', ['finish-sketch']]],
    Assembly: [['Components', ['box', 'cylinder', 'tube', 'gear']], ['Position', ['move', 'rotate', 'scale']], ['Repeat', ['duplicate', 'linear', 'circular', 'mirror']], ['Combine', ['union', 'subtract', 'intersect']], ['Presentation', ['explode', ['isolate', 'show-all', 'visibility']]]],
    Inspect: [['Analyze', ['measure', 'dimensions', 'mass']], ['Section', ['section', 'xray']], ['Display', ['fit', 'fit-selection']], ['Output', ['snapshot', 'export']]],
    View: [['Orientation', ['iso', 'top', 'front', 'right']], ['Projection', ['perspective']], ['Display style', ['shaded-edges', 'shaded', 'wireframe', 'xray']], ['Reference', ['grid', 'dimensions', 'section']], ['Workspace', ['theme', 'toggle-properties']]]
};
function buttonHTML(cmd, small = false) { const c = commands[cmd]; return `<button class="${small ? 'ribbon-small' : 'ribbon-button'} ${isActive(cmd) ? 'active' : ''}" data-command="${cmd}" title="${escapeHTML(c.hint + (c.key ? ' · ' + c.key : ''))}" aria-label="${escapeHTML(c.label)}">${icon(c.icon, small ? 16 : 28)}<span>${escapeHTML(c.label)}</span></button>`; }
function isActive(c) { return c === state.tool || c === state.sketchTool && state.tool === 'sketch' || c === 'grid' && state.grid || c === 'dimensions' && state.dimensions || c === 'section' && state.section || c === 'perspective' && camera.perspective || c === 'snap' && state.snap || c === 'explode' && state.explode > 0 || ['shaded-edges', 'shaded', 'wireframe', 'xray'][state.mode] === c; }
function renderRibbon() {
    $('#workspace-tabs').innerHTML = Object.keys(tabGroups).map(t => `<button data-tab="${t}" class="${state.tab === t ? 'active' : ''}">${t}</button>`).join('');
    $('#ribbon').innerHTML = tabGroups[state.tab].map(([label, groups]) => `<div class="ribbon-group"><div class="ribbon-group-tools">${groups.map(g => Array.isArray(g) ? `<div class="ribbon-stack">${g.map(c => buttonHTML(c, true)).join('')}</div>` : buttonHTML(g)).join('')}</div><div class="ribbon-group-label">${label}</div></div>`).join('');
    $('#viewport-tools').innerHTML = ['select', 'sketch', 'move', 'measure', '|', 'fit', 'iso', '|', 'section'].map(c => c === '|' ? '<div class="divider"></div>' : `<button data-command="${c}" class="${isActive(c) ? 'active' : ''}" title="${commands[c].label}${commands[c].key ? ' · ' + commands[c].key : ''}">${icon(commands[c].icon)}</button>`).join('');
    $('#view-controls').innerHTML = `<button data-command="display-menu" title="Display style">${icon(['cube', 'sphere', 'mesh', 'eye'][state.mode])}<span>${['Shaded + edges', 'Shaded', 'Wireframe', 'X-ray'][state.mode]}</span>${icon('down', 12)}</button><div class="divider"></div><button data-command="grid" class="${state.grid ? 'active' : ''}" title="Ground grid · G">${icon('grid')}</button><button data-command="perspective" class="${camera.perspective ? 'active' : ''}" title="Projection">${icon('orbit')}<span>${camera.perspective ? 'Perspective' : 'Orthographic'}</span></button><div class="divider"></div><button data-command="fit" title="Fit all · F">${icon('fit')}</button>`;
    $('#snap-button').classList.toggle('active', state.snap);
    $('#snap-button').textContent = state.snap ? 'Snap ' + length(state.snapSize) : 'Snap off';
    $('#units-button').textContent = state.displayUnits;
}
function updateTitles() { for (const id of ['title-name', 'viewport-title', 'doc-tab-name'])
    $('#' + id).textContent = doc.name; document.title = doc.name + ' · Axiom CAD'; $('#workspace-label').textContent = state.tool === 'sketch' ? 'SKETCH' : doc.bodies.length > 1 ? 'ASSEMBLY' : 'PART'; $('#context-label').textContent = state.tool === 'sketch' ? state.sketchPlane + ' PLANE' : state.tab === 'Inspect' ? 'INSPECT' : 'DESIGN'; $('#viewport-subtitle').textContent = state.tool === 'sketch' ? 'Closed profiles · ' + (state.snap ? '1 mm grid snapping' : 'Free placement') : 'Parametric bodies · Local-first workspace'; $('#empty-state').classList.toggle('hidden', doc.bodies.length > 0 || doc.sketches.length > 0 || state.tool === 'sketch'); }
function renderTree() {
    const tree = $('#tree'), scroll = tree.scrollTop;
    if (treeTab === 'history') {
        tree.innerHTML = history.length ? history.slice().reverse().map(h => `<div class="history-item">${icon('history', 15)}<div>${escapeHTML(h.name)}<small>${new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</small></div></div>`).join('') : '<div class="tree-empty">Your modeling operations appear here.<br><br>Use Undo and Redo to step through document changes.</div>';
        return;
    }
    const q = state.filter.toLowerCase(), bodies = doc.bodies.filter(b => !q || (b.name + ' ' + b.kind + ' ' + b.features.map(f => f.name || f.type).join(' ')).toLowerCase().includes(q));
    let html = `<div class="tree-heading">${icon('cube', 17)}<span>${escapeHTML(doc.name)}</span></div><button class="tree-group" data-toggle-group="planes">${icon(state.planesExpanded ? 'down' : 'chevron', 11)}${icon('plane', 14)}Reference planes</button>`;
    if (state.planesExpanded)
        html += ['XY', 'XZ', 'YZ'].map(p => `<div class="tree-row plane" data-plane="${p}" title="Sketch on the ${p} plane">${icon('plane', 14)}<span class="tree-label">${p} plane</span></div>`).join('');
    html += `<button class="tree-group" style="width:100%" data-toggle-group="bodies">${icon(state.bodiesExpanded ? 'down' : 'chevron', 11)}Design bodies<span class="count">${doc.bodies.length}</span></button>`;
    if (state.bodiesExpanded)
        for (const b of bodies) {
            let expanded = state.expanded.has(b.id);
            html += `<div class="tree-row ${state.selected.includes(b.id) ? 'selected' : ''} ${b.visible === false ? 'invisible' : ''}" data-body="${b.id}" title="${escapeHTML(b.name)}"><button class="tree-disclosure ${expanded ? 'expanded' : ''}" data-expand="${b.id}" title="Show features">${b.features.length ? icon('chevron', 10) : ''}</button>${icon(['boolean', 'mirror'].includes(b.kind) ? 'cube' : b.kind, 16)}<span class="tree-label">${escapeHTML(b.name)}</span><button class="tree-eye" data-eye="${b.id}" title="${b.visible === false ? 'Show' : 'Hide'} body">${icon(b.visible === false ? 'eyeoff' : 'eye', 14)}</button></div>`;
            if (expanded)
                html += b.features.map((f, i) => `<div class="tree-row feature ${f.suppressed ? 'suppressed' : ''}" data-feature-body="${b.id}" data-feature-index="${i}" title="Edit feature">${icon(f.type, 13)}<span class="tree-label">${escapeHTML(f.name || f.type)}</span></div>`).join('');
        }
    if (!bodies.length)
        html += '<div class="tree-empty">' + (q ? 'No matching bodies.' : 'No bodies yet. Create a primitive or extrude a sketch.') + '</div>';
    html += `<button class="tree-group" style="width:100%" data-toggle-group="sketches">${icon(state.sketchesExpanded ? 'down' : 'chevron', 11)}Sketches<span class="count">${doc.sketches.length}</span></button>`;
    if (state.sketchesExpanded)
        html += doc.sketches.filter(s => !q || s.name.toLowerCase().includes(q)).map(s => `<div class="tree-row ${s.id === state.selectedSketch ? 'selected' : ''}" data-sketch="${s.id}" style="padding-left:33px">${icon('sketch', 15)}<span class="tree-label">${escapeHTML(s.name)}</span><button class="tree-eye" data-sketch-eye="${s.id}" title="Toggle sketch visibility">${icon(s.visible ? 'eye' : 'eyeoff', 14)}</button></div>`).join('');
    tree.innerHTML = html;
    tree.scrollTop = scroll;
}
const dimensionFields = { box: [['width', 'Width'], ['depth', 'Depth'], ['height', 'Height'], ['radius', 'Corner radius']], cylinder: [['radius', 'Radius'], ['height', 'Height'], ['bevel', 'Rim bevel']], tube: [['radius', 'Outer radius'], ['innerRadius', 'Inner radius'], ['height', 'Length']], sphere: [['radius', 'Radius']], gear: [['radius', 'Tip radius'], ['height', 'Thickness'], ['teeth', 'Teeth', 'count'], ['bore', 'Bore radius']], extrude: [['height', 'Distance']], revolve: [['angle', 'Sweep', 'angle']], mirror: [['offset', 'Plane offset']] };
function renderInspector() {
    const root = $('#inspector'), b = selectedBody(), sketch = selectedSketch();
    if (sketch) {
        const bounds = profileBounds(sketch.points);
        root.innerHTML = `<section class="inspector-section"><div class="selection-card"><div class="selection-icon">${icon('sketch', 25)}</div><div><h2>Sketch profile</h2><small>${sketch.plane} reference plane</small></div></div><input class="full-input" value="${escapeHTML(sketch.name)}" data-sketch-name aria-label="Sketch name"></section><section class="inspector-section"><h3>Dimensions<span class="unit-label">${state.displayUnits}</span></h3>${[['width', 'Width', bounds.width], ['height', 'Height', bounds.height]].map(([k, l, v]) => `<div class="property-row"><label>${l}</label><input type="number" min="0.01" max="10000" step="any" value="${val(v)}" data-sketch-size="${k}" aria-label="Sketch ${l}"></div>`).join('')}<div class="property-row"><label>Vertices</label><span>${sketch.points.length}</span></div><div class="property-row"><label>Profile</label><span class="info-pill">${icon('check', 11)}Closed</span></div></section><section class="inspector-section"><h3>Build from this sketch</h3><button class="primary-button" data-command="extrude" style="width:100%">${icon('extrude', 16)}Extrude profile</button><div class="body-actions"><button class="secondary-button" data-command="sketch">Edit sketch</button><button class="secondary-button danger" data-command="delete">Delete</button></div></section><div class="inspector-tip"><b>Associative extrusion</b>Extrusions referencing this sketch rebuild when its dimensions change. Width and height scale the profile about its center.</div>`;
        return;
    }
    if (state.selected.length > 1) {
        let ms = meshes.filter(m => state.selected.includes(m.id));
        const total = ms.reduce((s, m) => s + massOf(m, doc.bodies.find(b => b.id === m.id)), 0);
        root.innerHTML = `<section class="inspector-section"><div class="selection-card"><div class="selection-icon">${icon('cube', 25)}</div><div><h2>${state.selected.length} bodies selected</h2><small>Multi-body selection</small></div></div><p class="assembly-summary">Shift-click bodies in the tree or viewport to add to the selection. Boolean subtraction uses selection order.</p></section><section class="inspector-section"><h3>Combine solids</h3>${['union', 'subtract', 'intersect'].map(c => `<button class="secondary-button" data-command="${c}" style="width:100%;margin-bottom:7px;justify-content:flex-start">${icon(commands[c].icon, 17)}${commands[c].label}</button>`).join('')}<p class="assembly-summary">${state.selected.length === 2 ? 'First: ' + escapeHTML(selectedBody().name) + '<br>Second: ' + escapeHTML(doc.bodies.find(x => x.id === state.selected[1])?.name) : 'Select exactly two bodies for a Boolean operation.'}</p></section><section class="inspector-section"><h3>Selection properties</h3><div class="property-row"><label>Approx. mass</label><span>${massText(total)}</span></div><div class="body-actions"><button class="secondary-button" data-command="move">Move</button><button class="secondary-button" data-command="duplicate">Duplicate</button></div><div class="body-actions"><button class="secondary-button danger" data-command="delete">Delete selection</button></div></section>`;
        return;
    }
    if (!b) {
        let mass = 0;
        for (const m of meshes) {
            const body = doc.bodies.find(b => b.id === m.id);
            if (body && !m.error)
                mass += massOf(m, body);
        }
        let bounds = meshBounds(), span = bounds ? V.sub(bounds.max, bounds.min) : [0, 0, 0];
        root.innerHTML = `<section class="inspector-section"><div class="selection-card"><div class="selection-icon">${icon('cube', 26)}</div><div><h2>Assembly overview</h2><small>${doc.bodies.length} bodies · ${doc.sketches.length} sketch${doc.sketches.length === 1 ? '' : 'es'}</small></div></div><p class="assembly-summary">Select a body to edit its dimensions, placement, features, and material.</p><div style="margin-top:13px"><span class="info-pill">${icon('check', 11)}Editable geometry</span></div></section><section class="inspector-section"><h3>Document</h3><div class="property-row"><input class="wide" data-document-name aria-label="Document name" value="${escapeHTML(doc.name)}"></div><div class="property-row"><label>Type</label><span>Multi-body assembly</span></div><div class="property-row"><label>Model units</label><span>Millimeters</span></div><div class="property-row"><label>Storage</label><span class="readonly">This browser</span></div></section><section class="inspector-section"><h3>Model statistics</h3><div class="stats-grid"><div class="stat-card"><strong>${doc.bodies.filter(b => b.visible !== false).length}</strong><span>Visible bodies</span></div><div class="stat-card"><strong>${number(meshes.reduce((s, m) => s + (m.triangleCount || 0), 0) / 1000, 1)}<small style="font-size:12px">k</small></strong><span>Triangles</span></div></div><div class="property-row" style="margin-top:15px"><label>Approx. mass</label><span>${massText(mass)}</span></div><div class="property-row"><label>Bounding size</label><span class="readonly" style="font-size:9px">${span.map(v => number(v / scaleFactor(), 0)).join(' × ')} ${state.displayUnits}</span></div></section><section class="inspector-section"><h3>Quick access</h3><div class="inspector-shortcuts"><div><span>Command search</span><kbd>⌘ K</kbd></div><div><span>Fit to window</span><kbd>F</kbd></div><div><span>Extrude a sketch</span><kbd>E</kbd></div><div><span>Undo an edit</span><kbd>⌘ Z</kbd></div></div></section><div class="inspector-tip"><b>${icon('info', 13)}Made for making.</b>Everything stays on your device. Save an Axiom file to keep the editable model, or export a mesh for other tools.</div>`;
        return;
    }
    const m = meshFor(b.id), fields = dimensionFields[b.kind] || [], material = MATERIALS[b.material] || MATERIALS.aluminum;
    let html = `<section class="inspector-section"><div class="selection-card"><div class="selection-icon">${icon(b.kind === 'boolean' ? 'union' : b.kind, 25)}</div><div><h2>${b.kind === 'mesh' ? 'Imported mesh' : b.kind === 'boolean' ? 'Boolean solid' : b.kind === 'mirror' ? 'Mirrored solid' : 'Parametric solid'}</h2><small>${m ? number(m.triangleCount) + ' triangles' : 'Rebuilding…'}</small></div></div><input class="full-input" value="${escapeHTML(b.name)}" data-body-name aria-label="Body name"></section>`;
    if (fields.length)
        html += `<section class="inspector-section"><h3>Parameters<span class="unit-label">${state.displayUnits}</span></h3>${fields.map(([key, label, type]) => `<div class="property-row"><label for="param-${key}">${label}</label><input id="param-${key}" type="number" step="${type === 'count' ? 1 : 'any'}" min="${['radius', 'bevel', 'bore', 'offset'].includes(key) ? key === 'offset' ? -10000 : 0 : 0.01}" max="${type === 'count' ? 128 : type === 'angle' ? 360 : 10000}" value="${type ? b.params[key] : val(b.params[key] || 0)}" data-param="${key}" data-unit="${type || 'length'}" aria-label="${label}"></div>`).join('')}${b.params.sketchId ? '<div class="info-pill" style="margin-top:10px">' + icon('link', 11) + 'Linked to sketch profile</div>' : ''}</section>`;
    html += `<section class="inspector-section"><h3>Placement</h3>${[['position', 'Position', state.displayUnits], ['rotation', 'Rotation', 'deg'], ['scale', 'Scale', '×']].map(([key, label, unit]) => `<div class="transform-label">${label}<span>${unit}</span></div><div class="xyz-grid">${['X', 'Y', 'Z'].map((axis, i) => `<div class="xyz-field"><label>${axis}</label><input type="number" step="any" value="${key === 'position' ? val(b[key][i]) : Number(b[key][i].toFixed(3))}" data-transform="${key}" data-axis-index="${i}" aria-label="${label} ${axis}"></div>`).join('')}</div>`).join('')}</section>`;
    html += `<section class="inspector-section"><h3>Material & appearance</h3><div class="material-preview"><span class="material-orb" style="background:${b.color}"></span><select data-material aria-label="Material">${Object.entries(MATERIALS).map(([key, m]) => `<option value="${key}" ${key === b.material ? 'selected' : ''}>${m.name}</option>`).join('')}</select></div><div class="property-row"><label>Body color</label><input type="color" value="${b.color}" data-color aria-label="Body color"></div><div class="color-swatches">${Object.entries(MATERIALS).map(([key, m]) => `<button class="color-swatch ${b.color === m.color ? 'active' : ''}" style="background:${m.color}" title="${m.name}" data-swatch="${key}"></button>`).join('')}</div></section>`;
    if (b.features.length)
        html += `<section class="inspector-section"><h3>Features<span class="unit-label">${b.features.length}</span></h3><div class="feature-list">${b.features.map((f, i) => `<div class="feature-list-item ${f.suppressed ? 'suppressed' : ''}"><input type="checkbox" ${f.suppressed ? '' : 'checked'} data-feature-toggle="${i}" aria-label="Enable ${escapeHTML(f.name || f.type)}">${icon(f.type, 14)}<button style="width:auto;flex:1;text-align:left" data-edit-feature="${i}" title="Edit feature">${escapeHTML(f.name || f.type)}</button><button data-remove-feature="${i}" title="Delete feature">${icon('close', 12)}</button></div>`).join('')}</div></section>`;
    html += `<section class="inspector-section"><h3>Physical properties</h3><div class="property-row"><label>Volume</label><span>${m ? number(m.volume / 1000, 2) : '—'} cm³</span></div><div class="property-row"><label>Surface area</label><span>${m ? number(m.area / 100, 2) : '—'} cm²</span></div><div class="property-row"><label>Approx. mass</label><span>${m ? massText(massOf(m, b)) : '—'}</span></div><div class="property-row"><label>Density</label><span>${material.density} g/cm³</span></div><div class="body-actions"><button class="secondary-button" data-command="duplicate">${icon('cube', 13)}Duplicate</button><button class="secondary-button danger" data-command="delete">${icon('trash', 13)}Delete</button></div></section>`;
    if (b.kind === 'boolean' || b.kind === 'mirror')
        html += `<div class="inspector-tip"><b>Snapshot-based dependency</b>Input shapes are stored inside this feature. Original bodies are preserved; later edits to the originals do not change this result.</div>`;
    if (b.kind === 'gear')
        html += `<div class="inspector-tip"><b>Concept geometry</b>The teeth use a radial trapezoid approximation, not an involute gear profile. Do not use this geometry for gear manufacturing.</div>`;
    root.innerHTML = html;
}
function updateStatus() { const c = state.selected.length; $('#status-selection').textContent = c ? c + ' bod' + (c === 1 ? 'y' : 'ies') + ' selected' : state.selectedSketch ? 'Sketch selected' : 'No selection'; $('#status-text').textContent = state.building ? 'Rebuilding' : state.buildError ? state.buildError + ' · Undo to recover' : state.tool === 'sketch' ? 'Sketch · ' + commands[state.sketchTool].label : state.tool === 'measure' ? 'Pick two surface points' : state.tool === 'move' ? 'Drag a steering axis or the selected body' : 'Ready'; $('#mesh-stats').textContent = doc.bodies.filter(b => b.visible !== false).length + ' bodies · ' + number(meshes.reduce((s, m) => s + (m.triangleCount || 0), 0)) + ' triangles'; $('#status-icon').innerHTML = icon(state.building ? 'history' : state.buildError ? 'info' : 'check', 12); }
function renderUI() { updateTitles(); renderTree(); renderInspector(); renderRibbon(); updateStatus(); invalidate(); }
function toast(message, error = false) { const div = document.createElement('div'); div.className = 'toast' + (error ? ' error' : ''); div.innerHTML = icon(error ? 'info' : 'check', 16) + '<span>' + escapeHTML(message) + '</span>'; $('#toast-region').append(div); setTimeout(() => div.remove(), error ? 6500 : 3600); }
function saveLocal() { clearTimeout(saveTimer); state.dirty = true; $('.save-dot').classList.add('unsaved'); $('#saved-state').textContent = 'Saving…'; saveTimer = setTimeout(() => { try {
    localStorage.setItem('axiom-cad:document', JSON.stringify(doc));
    state.dirty = false;
    $('.save-dot').classList.remove('unsaved');
    $('#saved-state').textContent = 'Saved';
}
catch {
    $('#saved-state').textContent = 'Save a file';
} }, 350); }
function commit(name, change, { fit = false, rebuild = true } = {}) { const before = JSON.stringify(doc); try {
    change();
    if (doc.bodies.length > LIMITS.bodies || doc.sketches.length > LIMITS.sketches || doc.bodies.some(b => b.features.length > LIMITS.features))
        throw Error('Document body, sketch or feature safety limit reached.');
}
catch (e) {
    doc = JSON.parse(before);
    toast(e.message, true);
    return false;
} if (JSON.stringify(doc) === before)
    return false; undoStack.push({ snapshot: before, name }); if (undoStack.length > 60)
    undoStack.shift(); while (undoStack.reduce((s, h) => s + h.snapshot.length, 0) > 32e6 && undoStack.length > 1)
    undoStack.shift(); redoStack = []; history.push({ name, time: Date.now() }); if (history.length > 100)
    history.shift(); state.fitNext = fit; state.hover = null; saveLocal(); if (rebuild)
    requestBuild();
else
    refreshGPU(); renderUI(); return true; }
function undo() { if (!undoStack.length) {
    toast('Nothing to undo.');
    return;
} const last = undoStack.pop(); redoStack.push({ snapshot: JSON.stringify(doc), name: last.name }); doc = JSON.parse(last.snapshot); state.selected = state.selected.filter(id => doc.bodies.some(b => b.id === id)); state.selectedSketch = null; history.push({ name: 'Undo · ' + last.name, time: Date.now() }); saveLocal(); requestBuild(); renderUI(); toast('Undid ' + last.name.toLowerCase()); }
function redo() { if (!redoStack.length) {
    toast('Nothing to redo.');
    return;
} const last = redoStack.pop(); undoStack.push({ snapshot: JSON.stringify(doc), name: last.name }); doc = JSON.parse(last.snapshot); history.push({ name: 'Redo · ' + last.name, time: Date.now() }); saveLocal(); requestBuild(); renderUI(); }
function createWorker() { if (globalThis.AXIOM_WORKER_SOURCE) {
    const url = URL.createObjectURL(new Blob([globalThis.AXIOM_WORKER_SOURCE], { type: 'text/javascript' }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    return w;
} return new Worker(new URL('./geometry-worker.js', import.meta.url), { type: 'module' }); }
function connectWorker() { worker = createWorker(); worker.onmessage = ({ data }) => { if (data.revision !== revision)
    return; clearTimeout(workerTimeout); clearTimeout(buildTimer); state.building = false; $('#busy').classList.add('hidden'); if (data.error) {
    state.buildError = data.error;
    toast(data.error, true);
    updateStatus();
    return;
} const errors = data.items.filter(m => m.error); builtRevision = revision; state.buildError = errors.length ? errors.length + ' geometry error(s)' : ''; for (const e of errors)
    toast((doc.bodies.find(b => b.id === e.id)?.name || 'Body') + ': ' + e.error, true); meshes = data.items.filter(m => !m.error); state.buildMs = data.buildMs; state.previewOffsets = {}; refreshGPU(); if (state.fitNext) {
    camera.fit(meshBounds());
    state.fitNext = false;
} renderInspector(); updateStatus(); invalidate(); window.dispatchEvent(new CustomEvent('axiom:rebuilt', { detail: { revision, buildMs: data.buildMs, errors: errors.length } })); }; worker.onerror = e => { state.building = false; $('#busy').classList.add('hidden'); clearTimeout(workerTimeout); state.buildError = 'Geometry worker failed'; toast('Geometry worker failed: ' + e.message, true); updateStatus(); }; }
function requestBuild() { if (!worker)
    return; for (const b of doc.bodies)
    if (b.kind === 'extrude' && b.params.sketchId) {
        const s = doc.sketches.find(s => s.id === b.params.sketchId);
        if (s)
            b.params.points = clone(s.points);
    } revision++; state.building = true; state.buildError = ''; clearTimeout(buildTimer); buildTimer = setTimeout(() => $('#busy').classList.remove('hidden'), 130); clearTimeout(workerTimeout); workerTimeout = setTimeout(() => { worker.terminate(); connectWorker(); state.building = false; $('#busy').classList.add('hidden'); state.buildError = 'Geometry timeout'; toast('Geometry operation exceeded the safety timeout. Undo it or reduce mesh complexity.', true); updateStatus(); }, 25000); const bodies = doc.bodies.map(b => { if (b.kind === 'extrude' && b.params.sketchId) {
    const s = doc.sketches.find(s => s.id === b.params.sketchId);
    if (s)
        return { ...b, params: { ...b.params, points: s.points } };
} return b; }); worker.postMessage({ revision, bodies }); updateStatus(); }
function refreshGPU() { if (!renderer)
    return; renderer.upload(meshes, doc.bodies, state.explode, state.previewOffsets); renderer.section(state.section, state.sectionZ); invalidate(); }
function invalidate() { if (!raf)
    raf = requestAnimationFrame(draw); }
function draw() { raf = 0; if (!renderer)
    return; camera.width = renderer.canvas.clientWidth; camera.height = renderer.canvas.clientHeight; camera.update(); renderer.render(camera, { selected: doc.bodies.findIndex(b => b.id === state.selected[0]) + 1, hover: doc.bodies.findIndex(b => b.id === state.hover) + 1, section: state.section, sectionZ: state.sectionZ, dark: state.dark, grid: state.grid, mode: state.mode }); renderOverlay(); $('#submit-stat').textContent = 'Submit ' + renderer.lastSubmitMs.toFixed(1) + ' ms'; frameCount++; }
function chooseBody(id, add = false) { state.selectedSketch = null; if (!id) {
    if (!add)
        state.selected = [];
}
else if (add) {
    state.selected = state.selected.includes(id) ? state.selected.filter(x => x !== id) : [...state.selected, id];
}
else
    state.selected = [id]; renderTree(); renderInspector(); updateStatus(); invalidate(); }
function chooseSketch(id) { state.selected = []; state.selectedSketch = id; renderTree(); renderInspector(); updateStatus(); invalidate(); }
function requireBody() { const b = selectedBody(); if (!b) {
    toast('Select a body in the model or PathFinder first.');
    return null;
} return b; }
function setTool(tool) { state.tool = tool; state.sketchDraft = null; state.sketchPolygon = []; state.sketchCursor = null; renderer?.canvas.classList.remove('tool-sketch', 'tool-move', 'tool-measure'); if (tool !== 'select')
    renderer?.canvas.classList.add('tool-' + tool); if (tool !== 'measure')
    state.measurement = []; if (tool === 'move' && !state.selected.length)
    toast('Select a body, then drag it or a steering axis.'); renderOperationPanel(); renderUI(); }
function setView(name) { camera.preset(name); $('#view-name').textContent = name[0].toUpperCase() + name.slice(1); $('.cube-home').textContent = name === 'iso' ? 'Isometric' : name[0].toUpperCase() + name.slice(1); invalidate(); }
function closeModal() { $('#modal').close(); }
function openForm({ title, subtitle = '', symbol = 'settings', fields = [], note = '', submit = 'Apply', onApply, width = 460, bodyHTML = '' }) {
    const dialog = $('#modal');
    dialog.onkeydown = null;
    dialog.className = '';
    dialog.style.width = width + 'px';
    dialog.innerHTML = `<form id="active-form"><div class="modal-header"><div class="modal-icon">${icon(symbol, 23)}</div><div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(subtitle)}</p></div><button type="button" class="icon-button" data-close-modal aria-label="Close">${icon('close', 16)}</button></div><div class="modal-body">${bodyHTML}<div class="modal-fields">${fields.map(f => { const key = escapeHTML(f.key), value = escapeHTML(f.value ?? ''); let input = f.type === 'select' ? `<select id="field-${key}" name="${key}">${f.options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${escapeHTML(v)}" ${String(v) === String(f.value) ? 'selected' : ''}>${escapeHTML(l)}</option>`; }).join('')}</select>` : f.type === 'textarea' ? `<textarea id="field-${key}" name="${key}" ${f.required === false ? '' : 'required'}>${value}</textarea>` : f.type === 'checkbox' ? `<label style="display:flex;align-items:center;gap:7px"><input type="checkbox" name="${key}" ${f.value ? 'checked' : ''} style="width:14px;height:14px">${escapeHTML(f.checkLabel || 'Enabled')}</label>` : `<input id="field-${key}" name="${key}" type="${f.type || 'number'}" value="${value}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} step="${f.step || 'any'}" ${f.required === false ? '' : 'required'} ${f.type === 'text' ? 'maxlength="120"' : ''}>`; return `<div class="modal-field ${f.full ? 'full' : ''}"><label for="field-${key}">${escapeHTML(f.label)}</label>${input}${f.hint ? '<span class="field-hint">' + escapeHTML(f.hint) + '</span>' : ''}</div>`; }).join('')}</div>${note ? `<div class="modal-note">${icon('info', 15)}<span>${escapeHTML(note)}</span></div>` : ''}<div class="form-error hidden" id="form-error" role="alert"></div></div><div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>${onApply ? 'Cancel' : 'Close'}</button>${onApply ? `<button class="primary-button" type="submit">${icon('check', 15)}${escapeHTML(submit)}</button>` : ''}</div></form>`;
    dialog.querySelectorAll('[data-close-modal]').forEach(b => b.onclick = closeModal);
    const form = $('#active-form');
    form.onsubmit = async (e) => { e.preventDefault(); if (!form.reportValidity())
        return; try {
        const data = {};
        for (const f of fields) {
            const input = form.elements.namedItem(f.key);
            data[f.key] = f.type === 'checkbox' ? input.checked : !f.type || f.type === 'number' ? Number(input.value) : input.value;
            if ((!f.type || f.type === 'number') && !Number.isFinite(data[f.key]))
                throw Error('Enter a finite number for ' + f.label + '.');
        }
        if (onApply) {
            const button = $('button[type=submit]', form);
            button.disabled = true;
            try {
                const result = await onApply(data);
                if (result !== false)
                    closeModal();
            }
            finally {
                button.disabled = false;
            }
        }
    }
    catch (error) {
        $('#form-error').textContent = error.message;
        $('#form-error').classList.remove('hidden');
    } };
    if (!dialog.open)
        dialog.showModal();
    requestAnimationFrame(() => { $('input,select,textarea', dialog)?.focus(); });
}
function showMenu(entries, anchor, x, y) { const menu = $('#menu'); menu.innerHTML = entries.map(e => e === '-' ? '<div class="separator"></div>' : typeof e === 'object' ? `<div class="menu-label">${escapeHTML(e.label)}</div>` : `<button data-command="${e}" role="menuitem">${icon(commands[e]?.icon || 'settings', 16)}<span>${escapeHTML(commands[e]?.label || e)}</span>${isActive(e) ? icon('check', 13) : commands[e]?.key ? '<kbd>' + commands[e].key + '</kbd>' : ''}</button>`).join(''); menu.classList.remove('hidden'); if (anchor) {
    const r = anchor.getBoundingClientRect();
    x = r.left;
    y = r.bottom + 4;
} menu.style.left = clamp(x || 12, 6, innerWidth - menu.offsetWidth - 6) + 'px'; menu.style.top = clamp(y || 78, 6, innerHeight - menu.offsetHeight - 6) + 'px'; }
function openCommandPalette() { const d = $('#modal'); d.className = 'command-palette'; d.style.width = '530px'; d.innerHTML = `<div class="palette-search">${icon('search', 21)}<input id="palette-input" placeholder="What would you like to create?" aria-label="Find a command" autocomplete="off"><kbd>esc</kbd></div><div class="palette-list" id="palette-list"></div><div class="palette-footer">↑ ↓ to navigate &nbsp; · &nbsp; Enter to run a command</div>`; let current = 0, results = []; const update = () => { const q = $('#palette-input').value.toLowerCase(); results = Object.entries(commands).filter(([key, c]) => !['search', 'file', 'collapse-tree'].includes(key) && (!q || (c.label + ' ' + c.hint).toLowerCase().includes(q))).slice(0, 45); current = clamp(current, 0, Math.max(0, results.length - 1)); $('#palette-list').innerHTML = results.map(([key, c], i) => `<button class="palette-command ${current === i ? 'active' : ''}" data-palette-command="${key}">${icon(c.icon, 20)}<span>${escapeHTML(c.label)}<small>${escapeHTML(c.hint)}</small></span>${c.key ? '<kbd>' + c.key + '</kbd>' : ''}</button>`).join('') || '<div class="tree-empty">No matching commands.</div>'; }; $('#palette-input').oninput = () => { current = 0; update(); }; d.onkeydown = e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    current = clamp(current + (e.key === 'ArrowDown' ? 1 : -1), 0, results.length - 1);
    update();
    $('.palette-command.active')?.scrollIntoView({ block: 'nearest' });
} if (e.key === 'Enter' && results[current]) {
    e.preventDefault();
    const c = results[current][0];
    d.close();
    d.onkeydown = null;
    runCommand(c);
} }; update(); if (!d.open)
    d.showModal(); $('#palette-input').focus(); }
function createPrimitive(kind) { const definitions = { box: [['width', 'Width', 50], ['depth', 'Depth', 40], ['height', 'Height', 30], ['radius', 'Corner radius', 3]], cylinder: [['radius', 'Radius', 18], ['height', 'Height', 40], ['bevel', 'Rim bevel', 1]], tube: [['radius', 'Outer radius', 22], ['innerRadius', 'Inner radius', 15], ['height', 'Length', 35]], sphere: [['radius', 'Radius', 22]], gear: [['radius', 'Tip radius', 40], ['height', 'Thickness', 12], ['teeth', 'Teeth', 20, 'count'], ['bore', 'Bore radius', 8]] }; const n = doc.bodies.filter(b => b.kind === kind).length + 1; let bounds = meshBounds(), positionX = bounds ? Math.ceil(bounds.max[0] + 35) : 0; openForm({ title: 'Create ' + commands[kind].label.toLowerCase(), subtitle: 'Editable parameters · ' + state.displayUnits, symbol: kind, fields: [{ key: 'name', label: 'Body name', type: 'text', value: commands[kind].label + ' ' + n, full: true }, ...definitions[kind].map(([key, label, value, type]) => ({ key, label: label + (type ? '' : ' (' + state.displayUnits + ')'), value: type ? value : val(value), min: key === 'radius' && kind === 'box' || ['bevel', 'bore'].includes(key) ? 0 : type ? 6 : .01, max: type ? 128 : 10000, step: type ? 1 : 'any' })), { key: 'x', label: 'Position X (' + state.displayUnits + ')', value: val(positionX), min: -10000, max: 10000 }, { key: 'z', label: 'Position Z (' + state.displayUnits + ')', value: 0, min: -10000, max: 10000 }], note: kind === 'gear' ? 'These are radial trapezoid teeth for concept visualization, not an involute manufacturing profile.' : 'Dimensions remain editable in Design properties. Geometry is generated in a dedicated worker.', submit: 'Create body', onApply: data => { const params = {}; for (const [k, , , type] of definitions[kind])
        params[k] = data[k] * (type ? 1 : scaleFactor()); validateShapeParameters(kind, params); const b = newBody(kind, params, { name: data.name.trim() || commands[kind].label, position: [data.x * scaleFactor(), 0, data.z * scaleFactor()] }); commit('Create ' + commands[kind].label, () => { doc.bodies.push(b); state.selected = [b.id]; state.selectedSketch = null; }, { fit: true }); } }); }
function beginSketch(tool = 'rect', plane) { const s = selectedSketch(); state.sketchPlane = plane || s?.plane || state.sketchPlane; state.tab = 'Sketch'; state.sketchTool = tool; state.section = false; state.explode = 0; state.selected = []; camera.perspective = false; camera.target = [0, 0, 0]; setView(state.sketchPlane === 'XY' ? 'top' : state.sketchPlane === 'XZ' ? 'front' : 'right'); if (s) {
    let b = profileBounds(s.points);
    camera.target = sketchWorld(s, [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2]);
    camera.span = Math.max(70, Math.hypot(b.width, b.height) * 1.3);
}
else
    camera.span = Math.max(150, camera.span); refreshGPU(); setTool('sketch'); }
function finishSketch() { if (state.sketchPolygon.length >= 3)
    saveSketch(state.sketchPolygon, 'Polyline'); state.sketchPolygon = []; state.tab = 'Home'; setTool('select'); setView('iso'); }
function extrudeSketch() { const s = selectedSketch() || doc.sketches.at(-1); if (!s) {
    beginSketch();
    toast('Draw a closed profile, then choose Extrude or press E.');
    return;
} K.triangulate(s.points); openForm({ title: 'Extrude profile', subtitle: s.name + ' · ' + s.plane + ' reference plane', symbol: 'extrude', fields: [{ key: 'name', label: 'Feature name', type: 'text', value: 'Extrusion ' + (doc.bodies.filter(b => b.kind === 'extrude').length + 1), full: true }, { key: 'height', label: 'Distance (' + state.displayUnits + ')', value: val(25), min: .01, max: 10000 }, { key: 'direction', label: 'Direction', type: 'select', value: 'forward', options: [['forward', 'Forward'], ['reverse', 'Reverse']] }], note: 'This extrusion stays linked to the sketch. Changing its width, height or vertices regenerates the solid.', submit: 'Extrude', onApply: d => { const rotation = s.plane === 'XZ' ? [90, 0, 0] : s.plane === 'YZ' ? [90, 0, 90] : [0, 0, 0]; const b = newBody('extrude', { points: clone(s.points), sketchId: s.id, height: d.height * scaleFactor() * (d.direction === 'reverse' ? -1 : 1) }, { name: d.name, position: s.origin || [0, 0, 0], rotation }); commit('Extrude ' + s.name, () => { doc.bodies.push(b); s.visible = false; state.selected = [b.id]; state.selectedSketch = null; }, { fit: true }); state.tab = 'Home'; setTool('select'); setView('iso'); } }); }
function revolveSketch() { const s = selectedSketch(), profile = s ? clone(s.points) : [[10, 0], [28, 0], [28, 7], [19, 13], [19, 35], [25, 40], [25, 47], [10, 47]]; openForm({ title: 'Revolve profile', subtitle: s ? s.name : 'Create a revolved example profile', symbol: 'revolve', fields: [{ key: 'name', label: 'Body name', type: 'text', value: 'Revolved body', full: true }, { key: 'angle', label: 'Sweep angle (degrees)', value: 360, min: 1, max: 360 }, { key: 'segments', label: 'Angular segments', value: 96, min: 12, max: 192, step: 1 }, { key: 'profile', label: 'Profile points [radius, Z] in millimeters', type: 'textarea', value: JSON.stringify(profile), full: true, hint: 'A closed polygon in R–Z space. All radii must be nonnegative.' }], note: 'The profile is revolved about world Z. This uses polygonal tessellation, not an analytic surface kernel.', submit: 'Revolve', onApply: d => { const points = JSON.parse(d.profile); validatePoints(points); if (points.some(p => p[0] < 0))
        throw Error('Revolve radii must be nonnegative. Move the sketch into positive X / radius space.'); K.triangulate(points); const b = newBody('revolve', { points, angle: d.angle, segments: d.segments }, { name: d.name, color: '#a6b3bc', material: 'steel' }); commit('Revolve profile', () => { doc.bodies.push(b); state.selected = [b.id]; state.selectedSketch = null; }, { fit: true }); state.tab = 'Home'; setTool('select'); setView('iso'); } }); }
function holeDialog(featureIndex = null) { const b = requireBody(); if (!b)
    return; const feature = featureIndex !== null ? b.features[featureIndex] : null, p = feature?.params || { radius: 5, depth: Math.max(100, (b.params.height || 60) + 4), axis: 'Z', x: 0, y: 0, z: -1 }; openForm({ title: feature ? 'Edit hole' : 'Create hole', subtitle: b.name + ' · Body-local coordinates', symbol: 'hole', fields: [{ key: 'radius', label: 'Radius (' + state.displayUnits + ')', value: val(p.radius), min: .01, max: 10000 }, { key: 'depth', label: 'Depth (' + state.displayUnits + ')', value: val(p.depth), min: .01, max: 20000 }, { key: 'axis', label: 'Positive drilling axis', type: 'select', value: p.axis, options: ['X', 'Y', 'Z'] }, { key: 'segments', label: 'Circular segments', value: p.segments || 64, min: 6, max: 192, step: 1 }, ...['x', 'y', 'z'].map(k => ({ key: k, label: 'Start ' + k.toUpperCase() + ' (' + state.displayUnits + ')', value: val(p[k] || 0), min: -20000, max: 20000 }))], note: 'The cutter starts at the supplied local X/Y/Z and extends along the positive selected axis. Extend it beyond both surfaces for a through hole.', submit: feature ? 'Update hole' : 'Cut hole', onApply: d => { const params = { axis: d.axis, segments: d.segments }; for (const k of ['radius', 'depth', 'x', 'y', 'z'])
        params[k] = d[k] * scaleFactor(); commit(feature ? 'Edit hole' : 'Cut hole', () => { if (feature)
        feature.params = params;
    else
        b.features.push({ id: uid(), type: 'hole', name: 'Hole · Ø' + number(params.radius * 2) + ' mm', params }); state.expanded.add(b.id); }); } }); }
function shellDialog(featureIndex = null) { const b = requireBody(); if (!b)
    return; if (b.kind !== 'box') {
    toast('Open-top shell currently supports parametric box bodies.', true);
    return;
} const feature = featureIndex !== null ? b.features[featureIndex] : null; openForm({ title: feature ? 'Edit shell' : 'Shell body', subtitle: b.name + ' · Open top', symbol: 'shell', fields: [{ key: 'thickness', label: 'Wall thickness (' + state.displayUnits + ')', value: val(feature?.params.thickness || 3), min: .01, max: 10000, full: true }], note: 'Removes the interior and top face while preserving a floor and side walls of the specified thickness.', submit: 'Apply shell', onApply: d => { const t = d.thickness * scaleFactor(); if (t * 2 >= Math.min(b.params.width, b.params.depth) || t >= b.params.height)
        throw Error('Wall thickness is larger than the available solid.'); commit(feature ? 'Edit shell' : 'Shell body', () => { if (feature)
        feature.params.thickness = t;
    else
        b.features.push({ id: uid(), type: 'shell', name: 'Open-top shell', params: { thickness: t } }); state.expanded.add(b.id); }); } }); }
function roundDialog(chamfer = false) { const b = requireBody(); if (!b)
    return; if (chamfer ? b.kind !== 'cylinder' : b.kind !== 'box') {
    toast(chamfer ? 'Rim chamfers apply to parametric cylinders.' : 'Vertical corner rounds apply to parametric boxes.', true);
    return;
} const key = chamfer ? 'bevel' : 'radius', limit = chamfer ? Math.min(b.params.radius * .7, b.params.height * .4) : Math.min(b.params.width, b.params.depth) / 2 - .001; openForm({ title: chamfer ? 'Chamfer rims' : 'Round vertical corners', subtitle: b.name, symbol: 'fillet', fields: [{ key: 'value', label: (chamfer ? 'Bevel' : 'Radius') + ' (' + state.displayUnits + ')', value: val(b.params[key] || 2), min: 0, max: val(limit), full: true }], note: chamfer ? 'Adds straight bevels at the top and bottom rims.' : 'Rounds the box footprint and its vertical corners. General edge fillets are not supported.', onApply: d => commit(chamfer ? 'Chamfer cylinder' : 'Round box corners', () => b.params[key] = d.value * scaleFactor()) }); }
function transformDialog(kind) { const b = requireBody(); if (!b)
    return; openForm({ title: commands[kind].label + ' bodies', subtitle: state.selected.length + ' selected · Local axes', symbol: kind, fields: kind === 'scale' ? [{ key: 'factor', label: 'Uniform scale multiplier', value: 1.5, min: .001, max: 100, full: true }] : ['x', 'y', 'z'].map((key, i) => ({ key, label: key.toUpperCase() + ' rotation (degrees)', value: b.rotation[i], min: -36000, max: 36000 })), note: kind === 'scale' ? 'Scales each selected body about its own local origin.' : 'Sets Euler rotations in X, then Y, then Z order about each body’s local origin.', onApply: d => commit(commands[kind].label + ' bodies', () => { for (const body of doc.bodies.filter(x => state.selected.includes(x.id)))
        if (kind === 'scale')
            body.scale = body.scale.map(v => v * d.factor);
        else
            body.rotation = [d.x, d.y, d.z]; }) }); }
function patternDialog(circular = false) { const b = requireBody(); if (!b)
    return; const fields = circular ? [{ key: 'count', label: 'Total instances (including original)', value: 6, min: 2, max: 64, step: 1 }, { key: 'angle', label: 'Sweep (degrees)', value: 360, min: 1, max: 360 }, { key: 'x', label: 'Pivot X (' + state.displayUnits + ')', value: val(b.position[0] - 50), min: -10000, max: 10000 }, { key: 'y', label: 'Pivot Y (' + state.displayUnits + ')', value: val(b.position[1]), min: -10000, max: 10000 }] : [{ key: 'count', label: 'Total instances (including original)', value: 4, min: 2, max: 64, step: 1 }, { key: 'spacing', label: 'Spacing (' + state.displayUnits + ')', value: val(40), min: -10000, max: 10000 }, { key: 'axis', label: 'World axis', type: 'select', value: 'X', options: ['X', 'Y', 'Z'], full: true }]; openForm({ title: circular ? 'Circular pattern' : 'Linear pattern', subtitle: b.name, symbol: circular ? 'radial' : 'pattern', fields, note: 'Instances are independent editable copies. Pattern placement is not constrained after creation.', submit: 'Create pattern', onApply: d => { const count = Math.round(d.count); commit(circular ? 'Circular pattern' : 'Linear pattern', () => { for (let i = 1; i < count; i++) {
        let copy = clone(b);
        copy.id = uid();
        copy.name = b.name + ' · ' + (i + 1);
        copy.features.forEach(f => f.id = uid());
        if (circular) {
            const angle = d.angle * Math.PI / 180 * i / (d.angle === 360 ? count : count - 1), cx = d.x * scaleFactor(), cy = d.y * scaleFactor(), x = b.position[0] - cx, y = b.position[1] - cy;
            copy.position = [cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle), b.position[2]];
            copy.rotation[2] += angle * 180 / Math.PI;
        }
        else
            copy.position[['X', 'Y', 'Z'].indexOf(d.axis)] += d.spacing * scaleFactor() * i;
        doc.bodies.push(copy);
    } }, { fit: true }); } }); }
function mirrorDialog() { const b = requireBody(); if (!b)
    return; openForm({ title: 'Mirror body', subtitle: b.name + ' · World reference plane', symbol: 'mirror', fields: [{ key: 'axis', label: 'Plane normal', type: 'select', value: 'X', options: [['X', 'X · YZ plane'], ['Y', 'Y · XZ plane'], ['Z', 'Z · XY plane']] }, { key: 'offset', label: 'Plane offset (' + state.displayUnits + ')', value: 0, min: -10000, max: 10000 }], note: 'Creates a reflected solid, preserving triangle orientation. The source is stored as a snapshot inside the mirror feature.', submit: 'Mirror', onApply: d => { const result = newBody('mirror', { source: clone(b), axis: d.axis, offset: d.offset * scaleFactor() }, { name: b.name + ' · mirrored', color: b.color, material: b.material }); commit('Mirror body', () => { doc.bodies.push(result); state.selected = [result.id]; }, { fit: true }); } }); }
function booleanOperation(operation) { if (state.selected.length !== 2) {
    toast('Shift-click exactly two bodies. The first is the target; the second is the tool.');
    return;
} const [a, b] = state.selected.map(id => doc.bodies.find(x => x.id === id)); if (a.visible === false || b.visible === false) {
    toast('Show both selected bodies before combining them.', true);
    return;
} if (state.building) {
    toast('The geometry is rebuilding. Run the operation once the status returns to Ready.');
    return;
} const result = newBody('boolean', { a: clone(a), b: clone(b), operation: operation === 'union' ? 'union' : operation === 'intersect' ? 'intersect' : 'subtract' }, { name: a.name + ' · ' + commands[operation].label.toLowerCase(), color: a.color, material: a.material }); commit(commands[operation].label + ' bodies', () => { a.visible = false; b.visible = false; doc.bodies.push(result); state.selected = [result.id]; }); toast('Original bodies are preserved and hidden in PathFinder.'); }
function duplicateSelection() { if (!requireBody())
    return; commit('Duplicate bodies', () => { const ids = []; for (const b of doc.bodies.filter(x => state.selected.includes(x.id))) {
    const copy = clone(b);
    copy.id = uid();
    copy.name += ' · copy';
    copy.position = V.add(copy.position, [20, 20, 0]);
    copy.features.forEach(f => f.id = uid());
    doc.bodies.push(copy);
    ids.push(copy.id);
} state.selected = ids; }, { fit: true }); }
function deleteSelection() { if (state.selectedSketch) {
    const id = state.selectedSketch;
    commit('Delete sketch', () => { const sketch = doc.sketches.find(s => s.id === id); for (const b of doc.bodies)
        if (b.kind === 'extrude' && b.params.sketchId === id) {
            b.params.points = clone(sketch.points);
            delete b.params.sketchId;
        } doc.sketches = doc.sketches.filter(s => s.id !== id); state.selectedSketch = null; });
    return;
} if (!state.selected.length)
    return; commit('Delete bodies', () => { doc.bodies = doc.bodies.filter(b => !state.selected.includes(b.id)); state.selected = []; }); }
function newDocument() { openForm({ title: 'New document', subtitle: 'A new idea, a clean workspace.', symbol: 'new', fields: [{ key: 'name', label: 'Document name', type: 'text', value: 'Untitled assembly', full: true }], note: 'The current document can be restored with Undo. Save an Axiom file first for a permanent copy.', submit: 'Create document', onApply: d => { commit('New document', () => { doc = blankDocument(); doc.name = d.name.trim() || 'Untitled assembly'; state.selected = []; state.selectedSketch = null; state.section = false; state.explode = 0; state.dimensions = false; }); state.tab = 'Home'; setTool('select'); setView('iso'); camera.target = [0, 0, 0]; camera.span = 180; } }); }
function loadSample(which) { commit('Open ' + (which === 'gears' ? 'gear pair' : 'bearing support') + ' sample', () => { doc = which === 'gears' ? gearboxSample() : bearingSample(); state.selected = []; state.selectedSketch = null; state.section = false; state.explode = 0; state.dimensions = false; }, { fit: true }); state.tab = 'Home'; setTool('select'); setView('iso'); }
function showMassProperties() { const selected = state.selected.length ? meshes.filter(m => state.selected.includes(m.id)) : meshes; const volume = selected.reduce((s, m) => s + m.volume, 0), area = selected.reduce((s, m) => s + m.area, 0), mass = selected.reduce((s, m) => s + massOf(m, doc.bodies.find(b => b.id === m.id)), 0), bounds = meshBounds(selected); openForm({ title: 'Mass properties', subtitle: state.selected.length ? 'Selected bodies' : 'All visible bodies', symbol: 'info', bodyHTML: `<div class="property-row"><label>Number of bodies</label><strong>${selected.length}</strong></div><div class="property-row"><label>Volume</label><strong>${number(volume / 1000, 3)} cm³</strong></div><div class="property-row"><label>Surface area</label><strong>${number(area / 100, 3)} cm²</strong></div><div class="property-row"><label>Approximate mass</label><strong>${massText(mass)}</strong></div>${bounds ? '<div class="property-row"><label>Bounding dimensions</label><span>' + V.sub(bounds.max, bounds.min).map(v => length(v)).join(' × ') + '</span></div>' : ''}`, note: 'Computed from triangulated surfaces and assigned material densities. Overlapping bodies are summed, not united. Open or nonmanifold imported meshes can yield unreliable volumes.' }); }
function showHelp() { openForm({ title: 'Make yourself at home.', subtitle: 'Navigation & keyboard shortcuts', symbol: 'help', width: 590, bodyHTML: `<div class="shortcut-grid">${[['Select', 'V'], ['Create sketch', 'S'], ['Extrude', 'E'], ['Hole', 'H'], ['Move body', 'M'], ['Measure distance', 'D'], ['Fit all', 'F'], ['Isometric', '0'], ['Front / top / right', '1 / 2 / 3'], ['Section plane', 'C'], ['Wireframe', 'W'], ['Grid', 'G'], ['Undo', '⌘ / Ctrl Z'], ['Redo', '⇧ ⌘ / Ctrl Z'], ['Save document', '⌘ / Ctrl S'], ['Open / import', '⌘ / Ctrl O'], ['Duplicate', '⌘ / Ctrl D'], ['Command search', '⌘ / Ctrl K'], ['Delete selection', 'Delete'], ['Hide selection', 'Space']].map(([a, b]) => `<div><span>${a}</span><kbd>${b}</kbd></div>`).join('')}</div><h3 class="help-section-title">Mouse & sketch controls</h3><p class="help-note">Drag empty space or right-drag to orbit. Middle-drag or Shift-right-drag to pan. Scroll to zoom at the cursor. Shift-click to select multiple bodies. In Move, drag the body or a colored steering axis. In a sketch, drag a rectangle or circle; click polyline vertices and press Enter to close. Drag the vertices of a selected sketch to edit it. Hold Shift for square rectangles and orthogonal polyline segments. Escape cancels the active tool.</p>`, note: 'The Mac Command key and Windows / Linux Control key are both supported. Numeric edits use the selected display units; native geometry remains in millimeters.' }); }
function showAbout() { openForm({ title: 'Axiom CAD', subtitle: 'Mechanical design, reimagined. · Build 0.1.0', symbol: 'logo', width: 570, bodyHTML: '<p>A framework-free, local-first 3D modeling workbench with a native WebGPU renderer and an explicitly identified WebGL2 fallback. All geometry is generated locally. No account, cloud model processing, CDN, or runtime package download is required.</p><p><strong>Implemented:</strong> parametric solids, closed sketch profiles, associative extrusion, revolved profiles, cylindrical bores, box shells, box-corner rounds, cylinder-rim chamfers, polygonal Boolean CSG, transforms, independent patterns, mirror features, measurement, clipping, exploded views, native JSON, STL/OBJ mesh import/export, PNG snapshots, and SVG drawings.</p><p><strong>Scope:</strong> this is a polygonal CAD workbench, not an exact B-rep kernel. It does not implement native Solid Edge or STEP/IGES files, constraint solving, assembly mates, general edge fillets, NURBS, sheet-metal unfolding, FEA, or manufacturing-certified geometry. Concept gears are not involute gears. Section cuts are uncapped.</p>', note: 'Inspired by the familiar ribbon, feature tree and property-panel workflow of desktop mechanical CAD. Independently branded; not affiliated with or endorsed by Siemens. All distances are stored in millimeters.' }); }
function sketchDimensionsDialog() { const s = selectedSketch(); if (!s) {
    toast('Select a sketch in PathFinder first.');
    return;
} const b = profileBounds(s.points); openForm({ title: 'Sketch dimensions', subtitle: s.name, symbol: 'dimension', fields: [{ key: 'width', label: 'Width (' + state.displayUnits + ')', value: val(b.width), min: .01, max: 10000 }, { key: 'height', label: 'Height (' + state.displayUnits + ')', value: val(b.height), min: .01, max: 10000 }], note: 'Scales the selected profile about its center. Linked extrusions rebuild automatically.', onApply: d => commit('Resize sketch', () => resizeSketch(s, d.width * scaleFactor(), d.height * scaleFactor())) }); }
function runCommand(cmd, anchor = null) {
    $('#menu').classList.add('hidden');
    try {
        switch (cmd) {
            case 'select':
                setTool('select');
                break;
            case 'sketch':
                beginSketch();
                break;
            case 'rect':
            case 'circle':
            case 'polygon':
                if (state.tool !== 'sketch')
                    beginSketch(cmd);
                else {
                    state.sketchTool = cmd;
                    state.sketchPolygon = [];
                    state.sketchDraft = null;
                    renderRibbon();
                    renderOperationPanel();
                    invalidate();
                }
                break;
            case 'finish-sketch':
                finishSketch();
                break;
            case 'sketch-size':
                sketchDimensionsDialog();
                break;
            case 'box':
            case 'cylinder':
            case 'tube':
            case 'sphere':
            case 'gear':
                createPrimitive(cmd);
                break;
            case 'extrude':
                extrudeSketch();
                break;
            case 'revolve':
                revolveSketch();
                break;
            case 'hole':
                holeDialog();
                break;
            case 'shell':
                shellDialog();
                break;
            case 'round':
                roundDialog();
                break;
            case 'chamfer':
                roundDialog(true);
                break;
            case 'move':
                setTool(state.tool === 'move' ? 'select' : 'move');
                break;
            case 'rotate':
            case 'scale':
                transformDialog(cmd);
                break;
            case 'duplicate':
                duplicateSelection();
                break;
            case 'delete':
                deleteSelection();
                break;
            case 'union':
            case 'subtract':
            case 'intersect':
                booleanOperation(cmd);
                break;
            case 'linear':
                patternDialog();
                break;
            case 'circular':
                patternDialog(true);
                break;
            case 'mirror':
                mirrorDialog();
                break;
            case 'measure':
                state.measurement = [];
                setTool(state.tool === 'measure' ? 'select' : 'measure');
                break;
            case 'dimensions':
                state.dimensions = !state.dimensions;
                renderRibbon();
                invalidate();
                break;
            case 'section':
                state.panel = 'section';
                state.section = !state.section;
                if (state.section) {
                    const b = meshBounds();
                    if (b)
                        state.sectionZ = (b.min[2] + b.max[2]) * .5;
                }
                renderer.section(state.section, state.sectionZ);
                renderOperationPanel();
                renderRibbon();
                invalidate();
                break;
            case 'explode':
                state.panel = 'explode';
                state.explode = state.explode ? 0 : .65;
                refreshGPU();
                renderOperationPanel();
                renderRibbon();
                break;
            case 'mass':
                showMassProperties();
                break;
            case 'fit':
                camera.fit(displayBounds());
                invalidate();
                break;
            case 'fit-selection':
                camera.fit(displayBounds(state.selected));
                invalidate();
                break;
            case 'iso':
            case 'top':
            case 'front':
            case 'right':
            case 'left':
            case 'back':
            case 'bottom':
                setView(cmd);
                break;
            case 'perspective':
                camera.perspective = !camera.perspective;
                renderRibbon();
                invalidate();
                break;
            case 'grid':
                state.grid = !state.grid;
                renderRibbon();
                invalidate();
                break;
            case 'shaded-edges':
            case 'shaded':
            case 'wireframe':
            case 'xray':
                state.mode = ['shaded-edges', 'shaded', 'wireframe', 'xray'].indexOf(cmd);
                renderRibbon();
                invalidate();
                break;
            case 'theme':
                state.dark = !state.dark;
                document.documentElement.dataset.theme = state.dark ? 'dark' : 'light';
                try {
                    localStorage.setItem('axiom-cad:theme', state.dark ? 'dark' : 'light');
                }
                catch { }
                renderRibbon();
                invalidate();
                break;
            case 'undo':
                undo();
                break;
            case 'redo':
                redo();
                break;
            case 'save':
                exportNative();
                break;
            case 'open':
                $('#file-input').click();
                break;
            case 'new':
                newDocument();
                break;
            case 'export':
                exportDialog();
                break;
            case 'snapshot':
                exportPNG();
                break;
            case 'sample-bearing':
                loadSample('bearing');
                break;
            case 'sample-gears':
                loadSample('gears');
                break;
            case 'show-all':
                commit('Show all bodies', () => doc.bodies.forEach(b => b.visible = true));
                break;
            case 'isolate':
                if (requireBody())
                    commit('Isolate bodies', () => doc.bodies.forEach(b => b.visible = state.selected.includes(b.id)));
                break;
            case 'visibility':
                if (requireBody())
                    commit('Toggle visibility', () => doc.bodies.filter(b => state.selected.includes(b.id)).forEach(b => b.visible = b.visible === false));
                break;
            case 'help':
                showHelp();
                break;
            case 'about':
                showAbout();
                break;
            case 'search':
                openCommandPalette();
                break;
            case 'units':
                showMenu([{ label: 'Display units' }, 'units-mm', 'units-in'], anchor || $('#units-button'));
                break;
            case 'units-mm':
            case 'units-in':
                state.displayUnits = cmd === 'units-mm' ? 'mm' : 'in';
                renderUI();
                renderOperationPanel();
                break;
            case 'snap':
                state.snap = !state.snap;
                renderRibbon();
                renderOperationPanel();
                break;
            case 'toggle-properties': {
                const p = $('#properties'), hidden = p.classList.contains('auto-hide') || p.classList.contains('hidden');
                p.classList.remove('auto-hide');
                p.classList.toggle('hidden', !hidden);
                invalidate();
                break;
            }
            case 'collapse-tree':
                state.expanded.clear();
                state.planesExpanded = false;
                renderTree();
                break;
            case 'file':
                showMenu(['new', 'open', 'save', '-', 'export', 'snapshot', '-', { label: 'Example documents' }, 'sample-bearing', 'sample-gears', '-', 'about'], anchor || $('.file-tab'));
                break;
            case 'display-menu':
                showMenu(['shaded-edges', 'shaded', 'wireframe', 'xray'], anchor);
                break;
            case 'reset-explode':
                state.explode = 0;
                refreshGPU();
                renderOperationPanel();
                renderRibbon();
                break;
            case 'clear-measure':
                state.measurement = [];
                renderOperationPanel();
                invalidate();
                break;
            default: toast('Unknown command: ' + cmd, true);
        }
    }
    catch (e) {
        toast(e.message, true);
        console.error(e);
    }
}
commands['units-mm'] = { label: 'Millimeters · mm', icon: 'ruler' };
commands['units-in'] = { label: 'Inches · in', icon: 'ruler' };
function displayBounds(ids = []) { const items = renderer?.drawItems?.filter(m => !ids.length || ids.includes(m.id)) || []; if (!items.length)
    return meshBounds(); return { min: [0, 1, 2].map(k => Math.min(...items.map(m => m.bounds.min[k] + m.offset[k]))), max: [0, 1, 2].map(k => Math.max(...items.map(m => m.bounds.max[k] + m.offset[k]))) }; }
function profileBounds(points) { const min = [0, 1].map(i => Math.min(...points.map(p => p[i]))), max = [0, 1].map(i => Math.max(...points.map(p => p[i]))); return { min, max, width: max[0] - min[0], height: max[1] - min[1] }; }
function resizeSketch(s, width, height) { const b = profileBounds(s.points); if (!Number.isFinite(width) || !Number.isFinite(height) || width < .001 || height < .001 || width > 100000 || height > 100000)
    throw Error('Enter positive sketch dimensions below 100,000 mm.'); const center = [0, 1].map(i => (b.min[i] + b.max[i]) / 2); s.points = s.points.map(p => [center[0] + (p[0] - center[0]) * width / b.width, center[1] + (p[1] - center[1]) * height / b.height]); }
function sketchWorld(sketch, point) { const p = sketch.plane === 'XZ' ? [point[0], 0, point[1]] : sketch.plane === 'YZ' ? [0, point[0], point[1]] : [point[0], point[1], 0]; return V.add(p, sketch.origin || [0, 0, 0]); }
function planePoint(x, y, plane = state.sketchPlane, origin = [0, 0, 0], snap = state.snap) { const normal = plane === 'XY' ? [0, 0, 1] : plane === 'XZ' ? [0, -1, 0] : [1, 0, 0]; const p = camera.onPlane(x, y, origin, normal); if (!p)
    return null; const a = V.sub(p, origin), uv = plane === 'XY' ? [a[0], a[1]] : plane === 'XZ' ? [a[0], a[2]] : [a[1], a[2]]; return snap ? uv.map(v => Math.round(v / state.snapSize) * state.snapSize) : uv; }
function saveSketch(points, label = 'Profile') { if (points.length < 3)
    return; const trimmed = points.map(p => p.map(v => Number(v.toFixed(5)))); if (trimmed.length > 3 && Math.hypot(trimmed[0][0] - trimmed.at(-1)[0], trimmed[0][1] - trimmed.at(-1)[1]) < .001)
    trimmed.pop(); K.triangulate(trimmed); const s = { id: uid(), name: label + ' ' + (doc.sketches.length + 1), plane: state.sketchPlane, origin: [0, 0, 0], points: trimmed, closed: true, visible: true }; commit('Create ' + label.toLowerCase() + ' sketch', () => { doc.sketches.push(s); state.selectedSketch = s.id; state.selected = []; }, { rebuild: false }); state.sketchDraft = null; state.sketchPolygon = []; renderOperationPanel(); return s; }
function renderOperationPanel() {
    const panel = $('#operation-panel');
    let html = '';
    if (state.tool === 'sketch') {
        html = `<h3>${icon('sketch', 17)}${commands[state.sketchTool].label} sketch</h3><p>${state.sketchTool === 'polygon' ? 'Click vertices. Press Enter or click the first point to close the profile.' : 'Click and drag on the plane to draw a ' + (state.sketchTool === 'circle' ? 'circle.' : 'rectangle.')}</p><label>Reference plane<select id="sketch-plane">${['XY', 'XZ', 'YZ'].map(p => `<option ${p === state.sketchPlane ? 'selected' : ''}>${p}</option>`).join('')}</select></label><label>Grid snap <button class="secondary-button" data-command="snap" style="font-size:10px;padding:5px 8px">${state.snap ? length(state.snapSize) : 'Off'}</button></label><div class="op-value" id="sketch-live-value" style="font-size:13px">${selectedSketch() ? escapeHTML(selectedSketch().name) : 'Draw a closed profile'}</div><div class="op-actions"><button class="secondary-button" data-command="finish-sketch">${icon('check', 13)}Finish</button><button class="primary-button" data-command="extrude">${icon('extrude', 14)}Extrude</button></div><p class="op-note">Drag a selected profile’s vertices to edit. Shift constrains squares and polyline axes.</p>`;
    }
    else if (state.tool === 'measure') {
        const a = state.measurement[0], b = state.measurement[1];
        html = `<h3>${icon('ruler', 17)}Point-to-point distance</h3><p>${!a ? 'Pick a point on a model surface.' : !b ? 'Pick a second point on a model surface.' : 'Distance between the two picked surface points.'}</p><div class="op-value">${a && b ? length(V.len(V.sub(a, b)), 3) : '— ' + state.displayUnits}</div>${a && b ? '<p>ΔX ' + length(Math.abs(a[0] - b[0])) + '<br>ΔY ' + length(Math.abs(a[1] - b[1])) + '<br>ΔZ ' + length(Math.abs(a[2] - b[2])) + '</p>' : ''}<div class="op-actions"><button class="secondary-button" data-command="clear-measure">Reset</button><button class="primary-button" data-command="select">Done</button></div><p class="op-note">Measured on the triangulated surface. Points are not associative with later model edits.</p>`;
    }
    else if (state.tool === 'move') {
        html = `<h3>${icon('move', 17)}Move bodies</h3><p>Drag a colored axis for constrained movement. Drag the body or center handle to move in the screen plane.</p><label>Grid snap <button class="secondary-button" data-command="snap" style="font-size:10px;padding:5px 8px">${state.snap ? length(state.snapSize) : 'Off'}</button></label><p class="op-note">Hold Alt to bypass snapping. You can also enter exact coordinates in Design properties.</p><div class="op-actions"><button class="primary-button" data-command="select">Done</button></div>`;
    }
    else if (state.section && state.panel !== 'explode') {
        const bounds = meshBounds();
        let min = bounds ? bounds.min[2] - 1 : -20, max = bounds ? bounds.max[2] + 1 : 100;
        html = `<h3>${icon('section', 17)}Section view</h3><p>Move the horizontal clipping plane through the visible model.</p><label>Plane Z<input id="section-value" type="number" value="${val(state.sectionZ)}" step="any"></label><input id="section-slider" type="range" min="${min}" max="${max}" value="${state.sectionZ}" step=".1" aria-label="Section plane height"><div class="op-actions"><button class="primary-button" data-command="section">Close section</button></div><p class="op-note">Visual clipping only. Orange lines mark surface intersections; cut faces are not capped. Exports keep the complete solids.</p>`;
    }
    else if (state.explode > 0) {
        html = `<h3>${icon('explode', 17)}Exploded assembly</h3><p>Separate the components to inspect their construction.</p><label>Separation<span id="explode-value">${Math.round(state.explode * 100)}%</span></label><input id="explode-slider" type="range" min="0" max="150" value="${state.explode * 100}" step="1" aria-label="Exploded view separation"><div class="op-actions"><button class="secondary-button" data-command="fit">Fit view</button><button class="primary-button" data-command="reset-explode">Reassemble</button></div><p class="op-note">Presentation only. Design positions and exported models are not changed.</p>`;
    }
    panel.innerHTML = html;
    panel.classList.toggle('hidden', !html);
    $('#sketch-plane')?.addEventListener('change', e => { state.selectedSketch = null; beginSketch(state.sketchTool, e.target.value); });
    const setSection = z => { state.sectionZ = z; renderer.section(true, z); invalidate(); };
    $('#section-slider')?.addEventListener('input', e => { setSection(Number(e.target.value)); $('#section-value').value = val(state.sectionZ); });
    $('#section-value')?.addEventListener('change', e => { const v = Number(e.target.value) * scaleFactor(); if (Number.isFinite(v)) {
        setSection(v);
        $('#section-slider').value = v;
    } });
    $('#explode-slider')?.addEventListener('input', e => { state.explode = Number(e.target.value) / 100; $('#explode-value').textContent = Math.round(state.explode * 100) + '%'; refreshGPU(); });
}
function labelSVG(x, y, text, color = '#4588a4', size = 10) { if (!Number.isFinite(x + y))
    return ''; const w = Math.max(30, text.length * size * .57 + 12); return `<g transform="translate(${x},${y})"><rect x="${-w / 2}" y="-10" width="${w}" height="19" rx="4" fill="${state.dark ? '#213747ee' : '#f8fcffee'}" stroke="${state.dark ? '#436174' : '#c1d7e3'}" stroke-width=".7"/><text fill="${color}" font-size="${size}" font-family="Inter,Segoe UI,sans-serif" text-anchor="middle" dominant-baseline="central">${escapeHTML(text)}</text></g>`; }
function lineDimension(a, b, text, offset = 18, color = '#438bab') { const p = camera.project(a), q = camera.project(b), dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy); if (len < 6)
    return ''; const nx = -dy / len * offset, ny = dx / len * offset; return `<g stroke="${color}" stroke-width=".85" fill="none"><path d="M${p[0]} ${p[1]}l${nx * 1.3} ${ny * 1.3}M${q[0]} ${q[1]}l${nx * 1.3} ${ny * 1.3}" opacity=".55"/><path d="M${p[0] + nx} ${p[1] + ny}L${q[0] + nx} ${q[1] + ny}" marker-start="url(#dim-arrow)" marker-end="url(#dim-arrow)"/></g>${labelSVG((p[0] + q[0]) / 2 + nx, (p[1] + q[1]) / 2 + ny, text, color)}`; }
function renderOverlay() {
    let html = `<defs><marker id="dim-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto-start-reverse"><path d="M0 0 5 2.5 0 5" fill="none" stroke="#438bab" stroke-width="1"/></marker></defs>`;
    for (const s of doc.sketches) {
        if (!s.visible && s.id !== state.selectedSketch && state.tool !== 'sketch')
            continue;
        if (state.tool === 'sketch' && s.plane !== state.sketchPlane)
            continue;
        const points = state.sketchPreview?.id === s.id ? state.sketchPreview.points : s.points, screen = points.map(p => camera.project(sketchWorld(s, p)));
        const selected = state.selectedSketch === s.id;
        html += `<path d="${screen.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join('')}Z" fill="${selected ? '#139ec914' : 'none'}" stroke="${selected ? '#148fc0' : '#689daf'}" stroke-width="${selected ? 1.5 : 1}" stroke-dasharray="${state.tool === 'sketch' ? '' : '5 4'}"/>`;
        if (selected && state.tool === 'sketch') {
            for (let i = 0; i < screen.length; i++) {
                if (points.length > 40 && i % Math.ceil(points.length / 16))
                    continue;
                const p = screen[i];
                html += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${state.dark ? '#1a3443' : 'white'}" stroke="#1688b2" stroke-width="1.2" data-sketch-handle="${i}" data-sketch-id="${s.id}" style="pointer-events:all;cursor:move"/>`;
            }
        }
    }
    if (state.tool === 'sketch') {
        let points = state.sketchDraft || state.sketchPolygon;
        if (points?.length) {
            const s = { plane: state.sketchPlane }, screen = points.map(p => camera.project(sketchWorld(s, p)));
            html += `<path d="${screen.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join('')}${state.sketchDraft ? 'Z' : ''}" fill="${state.sketchDraft ? '#149eca12' : 'none'}" stroke="#0e95bd" stroke-width="1.4"/>`;
            if (state.sketchPolygon.length && state.sketchCursor) {
                const a = screen.at(-1), b = camera.project(sketchWorld(s, state.sketchCursor));
                html += `<path d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}" stroke="#159ec4" stroke-dasharray="4 4" fill="none"/>`;
            }
            for (const p of screen)
                if (screen.length < 10)
                    html += `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#f6fcff" stroke="#168fb4"/>`;
            if (state.sketchDraft?.length === 4) {
                html += lineDimension(sketchWorld(s, points[0]), sketchWorld(s, points[1]), length(Math.abs(points[1][0] - points[0][0])), -17);
                html += lineDimension(sketchWorld(s, points[1]), sketchWorld(s, points[2]), length(Math.abs(points[2][1] - points[1][1])), -17);
            }
        }
    }
    if (state.dimensions && state.selected.length) {
        const b = displayBounds(state.selected);
        if (b) {
            const a = b.min, c = b.max;
            html += lineDimension([a[0], a[1], a[2]], [c[0], a[1], a[2]], length(c[0] - a[0]), 24);
            html += lineDimension([c[0], a[1], a[2]], [c[0], c[1], a[2]], length(c[1] - a[1]), 23);
            html += lineDimension([c[0], c[1], a[2]], [c[0], c[1], c[2]], length(c[2] - a[2]), 23);
        }
    }
    if (state.tool === 'move' && state.selected.length) {
        const bounds = displayBounds(state.selected);
        if (bounds) {
            const c = V.mul(V.add(bounds.min, bounds.max), .5), p = camera.project(c);
            const colors = ['#d58271', '#57a28b', '#529cc7'];
            for (let i = 0; i < 3; i++) {
                const end = c.slice();
                end[i] += camera.span * .14;
                const q = camera.project(end);
                html += `<g data-gizmo-axis="${i}" style="cursor:move;pointer-events:all"><path d="M${p[0]} ${p[1]}L${q[0]} ${q[1]}" fill="none" stroke="transparent" stroke-width="15"/><path d="M${p[0]} ${p[1]}L${q[0]} ${q[1]}" stroke="${colors[i]}" stroke-width="2.2"/><circle cx="${q[0]}" cy="${q[1]}" r="5" fill="${colors[i]}" stroke="${state.dark ? '#182c38' : 'white'}" stroke-width="1"/><text x="${q[0] + 10}" y="${q[1] - 8}" font-size="11" font-weight="600" fill="${colors[i]}">${'XYZ'[i]}</text></g>`;
            }
            html += `<circle cx="${p[0]}" cy="${p[1]}" r="7" fill="${state.dark ? '#243d4b' : 'white'}" stroke="#72a7bf" stroke-width="2" data-gizmo-axis="free" style="cursor:move;pointer-events:all"/>`;
        }
    }
    if (state.measurement.length) {
        for (const p of state.measurement) {
            const q = camera.project(p);
            html += `<circle cx="${q[0]}" cy="${q[1]}" r="4" fill="#f4af59" stroke="#fff" stroke-width="1.2"/>`;
        }
        if (state.measurement.length === 2) {
            const [a, b] = state.measurement;
            html += lineDimension(a, b, length(V.len(V.sub(a, b)), 3), 0);
        }
    }
    $('#overlay').innerHTML = html;
    const center = camera.project(camera.target), colors = ['#c17f73', '#71a18f', '#6f9cbd'];
    let triad = '';
    const axes = [0, 1, 2].map(i => { const p = camera.target.slice(); p[i] += camera.span * .1; const q = camera.project(p), dx = (q[0] - center[0]) / (camera.height * .1) * 29, dy = (q[1] - center[1]) / (camera.height * .1) * 29; return { i, x: 40 + dx, y: 48 + dy, depth: q[2] }; }).sort((a, b) => b.depth - a.depth);
    for (const a of axes)
        triad += `<path d="M40 48L${a.x} ${a.y}" stroke="${colors[a.i]}" stroke-width="1.8"/><circle cx="${a.x}" cy="${a.y}" r="2" fill="${colors[a.i]}"/><text x="${a.x + (a.x > 40 ? 7 : -8)}" y="${a.y + (a.y > 48 ? 8 : -5)}" font-family="Inter,Segoe UI,sans-serif" font-size="10" fill="${colors[a.i]}">${'XYZ'[a.i]}</text>`;
    $('#triad').innerHTML = triad + '<circle cx="40" cy="48" r="2.7" fill="#789cac"/>';
    const targetUnits = 80 * camera.span / camera.height, power = 10 ** Math.floor(Math.log10(targetUnits || 1)), s = [1, 2, 5, 10].map(v => v * power).reduce((a, b) => Math.abs(a - targetUnits) < Math.abs(b - targetUnits) ? a : b);
    $('#scale-label').textContent = length(s);
    $('#scale-bar').style.width = clamp(s / camera.span * camera.height, 30, 150) + 'px';
}
function pick(x, y) { if (!renderer)
    return null; const r = camera.ray(x, y); let best = null; for (const item of renderer.drawItems) {
    if (!doc.bodies.some(b => b.id === item.id && b.visible !== false))
        continue;
    const o = V.sub(r.o, item.offset);
    if (!rayBounds(o, r.d, item.bounds))
        continue;
    const p = item.vertices;
    for (let i = 0; i < p.length; i += 18) {
        const hit = rayTriangle(o, r.d, [p[i], p[i + 1], p[i + 2]], [p[i + 6], p[i + 7], p[i + 8]], [p[i + 12], p[i + 13], p[i + 14]]);
        if (hit && (!best || hit.t < best.t)) {
            const point = V.add(hit.point, item.offset);
            if (state.section && point[2] > state.sectionZ + .00001)
                continue;
            best = { ...hit, point, id: item.id, triangle: i / 18 };
        }
    }
} return best; }
let drag = null, lastHoverTime = 0;
function pointerXY(e) { const r = renderer.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function beginMove(e, axis = 'free', hit = null) { const bounds = displayBounds(state.selected); if (!bounds)
    return; const [x, y] = pointerXY(e), center = V.mul(V.add(bounds.min, bounds.max), .5), normal = V.norm(V.sub(camera.eye, camera.target)), startPlane = camera.onPlane(x, y, center, normal); drag = { kind: 'move', axis, x, y, center, normal, startPlane, delta: [0, 0, 0], positions: doc.bodies.filter(b => state.selected.includes(b.id)).map(b => ({ id: b.id, position: b.position.slice() })), moved: false }; renderer.canvas.setPointerCapture(e.pointerId); }
function pointerDown(e) {
    if (e.button > 2)
        return;
    $('#menu').classList.add('hidden');
    renderer.canvas.focus({ preventScroll: true });
    const [x, y] = pointerXY(e);
    renderer.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 && e.shiftKey) {
        drag = { kind: 'pan', x, y, lastX: x, lastY: y, moved: false, button: e.button };
        e.preventDefault();
        return;
    }
    if (e.button === 2 || e.altKey && state.tool !== 'move') {
        drag = { kind: 'orbit', x, y, lastX: x, lastY: y, moved: false, button: e.button };
        e.preventDefault();
        return;
    }
    if (state.tool === 'sketch') {
        const p = planePoint(x, y);
        if (!p)
            return;
        if (state.sketchTool === 'polygon') {
            drag = { kind: 'polygon', x, y, point: p, moved: false };
        }
        else {
            drag = { kind: 'sketch', x, y, point: p, moved: false };
            state.sketchDraft = null;
        }
        return;
    }
    const hit = pick(x, y);
    if (state.tool === 'measure') {
        drag = { kind: 'measure', x, y, hit, moved: false };
        return;
    }
    if (state.tool === 'move' && hit) {
        if (!state.selected.includes(hit.id))
            chooseBody(hit.id, e.shiftKey);
        beginMove(e, 'free', hit);
        return;
    }
    drag = { kind: 'orbit', x, y, lastX: x, lastY: y, moved: false, button: e.button, hit, shift: e.shiftKey };
}
function pointerMove(e) {
    if (!renderer)
        return;
    const [x, y] = pointerXY(e);
    if (drag) {
        const dx = x - drag.x, dy = y - drag.y;
        if (Math.hypot(dx, dy) > 3)
            drag.moved = true;
        if (drag.kind === 'pan' || drag.kind === 'orbit') {
            if (drag.moved) {
                renderer.canvas.classList.add('dragging');
                if (drag.kind === 'pan')
                    camera.pan(x - drag.lastX, y - drag.lastY);
                else
                    camera.orbit(x - drag.lastX, y - drag.lastY);
                drag.lastX = x;
                drag.lastY = y;
                invalidate();
            }
            return;
        }
        if (drag.kind === 'move') {
            let delta = [0, 0, 0];
            if (drag.axis === 'free') {
                const p = camera.onPlane(x, y, drag.center, drag.normal);
                if (!p || !drag.startPlane)
                    return;
                delta = V.sub(p, drag.startPlane);
            }
            else {
                const axis = Number(drag.axis), p = camera.project(drag.center), end = drag.center.slice();
                end[axis] += 10;
                const q = camera.project(end), vx = (q[0] - p[0]) / 10, vy = (q[1] - p[1]) / 10, denom = vx * vx + vy * vy;
                if (denom < 1e-6)
                    return;
                delta[axis] = (dx * vx + dy * vy) / denom;
            }
            if (state.snap && !e.altKey)
                delta = delta.map(n => Math.round(n / state.snapSize) * state.snapSize);
            drag.delta = delta;
            state.previewOffsets = Object.fromEntries(drag.positions.map(b => [b.id, delta]));
            refreshGPU();
            return;
        }
        if (drag.kind === 'vertex') {
            const s = doc.sketches.find(s => s.id === drag.id), p = planePoint(x, y, s.plane, s.origin || [0, 0, 0], state.snap && !e.altKey);
            if (p) {
                state.sketchPreview.points[drag.index] = p;
                invalidate();
            }
            return;
        }
        if (drag.kind === 'sketch') {
            const p = planePoint(x, y);
            if (!p)
                return;
            const a = drag.point;
            let b = p;
            if (state.sketchTool === 'rect') {
                if (e.shiftKey) {
                    const size = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
                    b = [a[0] + Math.sign(b[0] - a[0] || 1) * size, a[1] + Math.sign(b[1] - a[1] || 1) * size];
                }
                state.sketchDraft = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
                $('#sketch-live-value').textContent = length(Math.abs(b[0] - a[0])) + ' × ' + length(Math.abs(b[1] - a[1]));
            }
            else {
                let r = Math.hypot(b[0] - a[0], b[1] - a[1]);
                if (state.snap)
                    r = Math.round(r / state.snapSize) * state.snapSize;
                state.sketchDraft = Array.from({ length: 80 }, (_, i) => [a[0] + r * Math.cos(i * Math.PI / 40), a[1] + r * Math.sin(i * Math.PI / 40)]);
                $('#sketch-live-value').textContent = 'Ø ' + length(r * 2);
            }
            invalidate();
            return;
        }
        return;
    }
    if (state.tool === 'sketch') {
        let p = planePoint(x, y);
        if (p && e.shiftKey && state.sketchPolygon.length) {
            const a = state.sketchPolygon.at(-1);
            if (Math.abs(p[0] - a[0]) > Math.abs(p[1] - a[1]))
                p[1] = a[1];
            else
                p[0] = a[0];
        }
        state.sketchCursor = p;
        invalidate();
        return;
    }
    if (e.target !== renderer.canvas || performance.now() - lastHoverTime < 65)
        return;
    lastHoverTime = performance.now();
    const hit = pick(x, y);
    if (hit?.id !== state.hover) {
        state.hover = hit?.id || null;
        invalidate();
    }
    const label = $('#hover-label');
    if (hit && state.tool === 'select') {
        label.textContent = doc.bodies.find(b => b.id === hit.id)?.name || 'Body';
        label.style.left = clamp(x + 14, 0, Math.max(0, camera.width - label.offsetWidth - 12)) + 'px';
        label.style.top = Math.min(y + 17, camera.height - 60) + 'px';
        label.classList.remove('hidden');
    }
    else
        label.classList.add('hidden');
}
function pointerUp(e) { if (!drag || !renderer)
    return; const d = drag; drag = null; renderer.canvas.classList.remove('dragging'); try {
    if (renderer.canvas.hasPointerCapture(e.pointerId))
        renderer.canvas.releasePointerCapture(e.pointerId);
}
catch { } try {
    if (d.kind === 'move') {
        if (d.moved && V.len(d.delta) > .000001) {
            state.previewOffsets = {};
            commit('Move bodies', () => { for (const start of d.positions) {
                const b = doc.bodies.find(b => b.id === start.id);
                if (b)
                    b.position = V.add(start.position, d.delta);
            } });
        }
        else {
            state.previewOffsets = {};
            refreshGPU();
        }
        return;
    }
    if (d.kind === 'vertex') {
        const preview = state.sketchPreview;
        state.sketchPreview = null;
        if (d.moved) {
            validatePoints(preview.points);
            commit('Edit sketch vertex', () => { doc.sketches.find(s => s.id === d.id).points = preview.points; });
        }
        invalidate();
        return;
    }
    if (d.kind === 'sketch') {
        if (d.moved && state.sketchDraft) {
            const points = state.sketchDraft;
            state.sketchDraft = null;
            saveSketch(points, state.sketchTool === 'rect' ? 'Rectangle' : 'Circle');
        }
        return;
    }
    if (d.kind === 'polygon') {
        let p = state.sketchCursor || d.point;
        if (e.shiftKey && state.sketchPolygon.length)
            p = state.sketchCursor;
        if (state.sketchPolygon.length >= 3) {
            const a = camera.project(sketchWorld({ plane: state.sketchPlane }, state.sketchPolygon[0])), b = camera.project(sketchWorld({ plane: state.sketchPlane }, p));
            if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 12) {
                saveSketch(state.sketchPolygon, 'Polyline');
                return;
            }
        }
        if (!state.sketchPolygon.length || Math.hypot(...state.sketchPolygon.at(-1).map((v, i) => v - p[i])) > .001)
            state.sketchPolygon.push(p.slice());
        invalidate();
        return;
    }
    if (d.kind === 'measure') {
        if (!d.moved && d.hit) {
            if (state.measurement.length === 2)
                state.measurement = [];
            state.measurement.push(d.hit.point);
            state.lastPick = d.hit;
            chooseBody(d.hit.id);
            renderOperationPanel();
            invalidate();
        }
        return;
    }
    if (d.kind === 'orbit' && !d.moved && d.button === 0) {
        state.lastPick = d.hit;
        chooseBody(d.hit?.id || null, d.shift);
    }
    else if (d.kind === 'orbit' && !d.moved && d.button === 2) {
        const [x, y] = pointerXY(e), hit = pick(x, y);
        if (hit && !state.selected.includes(hit.id))
            chooseBody(hit.id);
        showMenu(hit ? ['move', 'rotate', 'duplicate', 'visibility', 'isolate', 'fit-selection', '-', 'hole', 'shell', '-', 'delete'] : ['fit', 'iso', '-', 'box', 'cylinder', 'sketch', '-', 'show-all'], null, e.clientX, e.clientY);
    }
}
catch (error) {
    state.sketchDraft = null;
    state.sketchPreview = null;
    toast(error.message, true);
    invalidate();
} }
function wirePointerEvents() { const c = renderer.canvas; c.addEventListener('pointerdown', pointerDown); window.addEventListener('pointermove', pointerMove); window.addEventListener('pointerup', pointerUp); window.addEventListener('pointercancel', () => { drag = null; state.previewOffsets = {}; state.sketchDraft = null; state.sketchPreview = null; refreshGPU(); }); c.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = pointerXY(e); camera.zoom(clamp(e.deltaY, -500, 500), x, y); invalidate(); }, { passive: false }); c.addEventListener('contextmenu', e => e.preventDefault()); c.addEventListener('pointerleave', () => { state.hover = null; $('#hover-label').classList.add('hidden'); invalidate(); }); c.addEventListener('dblclick', e => { if (state.tool === 'sketch' && state.sketchPolygon.length >= 3) {
    saveSketch(state.sketchPolygon, 'Polyline');
    return;
} if (state.selected.length)
    runCommand('fit-selection'); }); $('#overlay').addEventListener('pointerdown', e => { const vertex = e.target.closest('[data-sketch-handle]'); if (vertex) {
    e.preventDefault();
    const s = doc.sketches.find(s => s.id === vertex.dataset.sketchId), [x, y] = pointerXY(e);
    state.sketchPreview = { id: s.id, points: clone(s.points) };
    drag = { kind: 'vertex', id: s.id, index: Number(vertex.dataset.sketchHandle), x, y, moved: false };
    renderer.canvas.setPointerCapture(e.pointerId);
    return;
} const axis = e.target.closest('[data-gizmo-axis]'); if (axis) {
    e.preventDefault();
    beginMove(e, axis.dataset.gizmoAxis);
} }); }
function safeFilename(name) { return (name || 'axiom-model').replace(/[^a-zA-Z0-9._ -]/g, '_').trim().replace(/\s+/g, '-').slice(0, 100) || 'axiom-model'; }
function download(data, name, type) { const blob = data instanceof Blob ? data : new Blob([data], { type }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
function exportNative() { download(JSON.stringify(doc, null, 2), safeFilename(doc.name) + '.axiom.json', 'application/json'); toast('Editable Axiom document saved.'); }
async function whenIdle(timeout = 30000) { const start = performance.now(); while (state.building || !renderer) {
    if (performance.now() - start > timeout)
        throw Error('The model is not ready. Check the geometry error and try Undo.');
    await new Promise(r => setTimeout(r, 40));
} await new Promise(r => requestAnimationFrame(r)); }
function exportItems(scope = 'visible') { if (builtRevision !== revision && !state.building)
    throw Error('The current model has no completed geometry build. Undo the failed edit before exporting.'); if (state.building)
    throw Error('The geometry is still rebuilding. Try exporting after the status returns to Ready.'); const bodies = doc.bodies.filter(b => b.visible !== false && (scope !== 'selected' || state.selected.includes(b.id))); if (!bodies.length)
    throw Error('There are no visible bodies in the requested export scope.'); const items = bodies.map(b => { const m = meshFor(b.id); if (!m)
    throw Error(b.name + ' has no valid geometry. Fix or undo the failed operation before exporting.'); return m; }); return items; }
function exportDialog() { openForm({ title: 'Export your design', subtitle: 'Interchange formats · Complete, unexploded geometry', symbol: 'export', fields: [{ key: 'format', label: 'File format', type: 'select', value: 'stl', options: [['stl', 'STL · binary triangle mesh'], ['obj', 'OBJ · mesh with vertex normals'], ['json', 'Axiom · editable document'], ['svg', 'SVG · orthographic wireframe drawing'], ['png', 'PNG · current viewport image']], full: true }, { key: 'scope', label: 'Geometry scope', type: 'select', value: state.selected.length ? 'selected' : 'visible', options: [['visible', 'All visible bodies'], ['selected', 'Selected visible bodies']], full: true }], note: 'STL and OBJ store meshes, not analytic CAD solids or feature history. Native Axiom export saves the entire editable document. SVG contains projected wireframe edges, not hidden-line-removed drafting geometry.', submit: 'Export file', onApply: async (d) => { await whenIdle(); if (d.format === 'json') {
        exportNative();
        return;
    } if (d.format === 'png') {
        await exportPNG();
        return;
    } const items = exportItems(d.scope), name = safeFilename(doc.name); if (d.format === 'stl')
        download(binarySTL(items), name + '.stl', 'model/stl'); if (d.format === 'obj')
        download(writeOBJ(items, doc.bodies), name + '.obj', 'text/plain'); if (d.format === 'svg')
        download(drawingSVG(items), name + '.svg', 'image/svg+xml'); toast(d.format.toUpperCase() + ' exported · ' + items.length + ' bod' + (items.length === 1 ? 'y' : 'ies')); } }); }
async function exportPNG() { await whenIdle(); renderer.render(camera, { selected: doc.bodies.findIndex(b => b.id === state.selected[0]) + 1, hover: 0, section: state.section, sectionZ: state.sectionZ, dark: state.dark, grid: state.grid, mode: state.mode }); const blob = await new Promise(resolve => renderer.canvas.toBlob(resolve, 'image/png')); if (!blob)
    throw Error('The browser could not capture the viewport.'); download(blob, safeFilename(doc.name) + '.png', 'image/png'); toast('Viewport image exported.'); }
function drawingSVG(items) { const width = 1123, height = 794, bounds = meshBounds(items); let content = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><rect x="24" y="24" width="1075" height="746" fill="none" stroke="#314b5b" stroke-width="1.2"/><text x="48" y="58" font-family="Arial,sans-serif" font-size="18" fill="#1c3b4d">${escapeHTML(doc.name)}</text><text x="48" y="79" font-family="Arial,sans-serif" font-size="10" fill="#72828b">AXIOM CAD · ORTHOGRAPHIC WIREFRAME · MODEL UNITS: MILLIMETERS</text><defs>`; const layouts = [['front', 38, 105, 510, 283], ['top', 38, 413, 510, 283], ['iso', 570, 135, 506, 485]]; layouts.forEach(([, x, y, w, h], i) => content += `<clipPath id="view${i}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>`); content += '</defs>'; layouts.forEach(([view, x, y, w, h], index) => { const cam = new Camera(); cam.width = w; cam.height = h; cam.preset(view); cam.fit(bounds); cam.span *= 1.05; cam.update(); let path = ''; for (const item of items)
    for (let i = 0; i < item.edges.length; i += 6) {
        const a = cam.project([item.edges[i], item.edges[i + 1], item.edges[i + 2]]), b = cam.project([item.edges[i + 3], item.edges[i + 4], item.edges[i + 5]]);
        path += `M${(a[0] + x).toFixed(2)} ${(a[1] + y).toFixed(2)}L${(b[0] + x).toFixed(2)} ${(b[1] + y).toFixed(2)}`;
    } content += `<path clip-path="url(#view${index})" d="${path}" fill="none" stroke="#314e5f" stroke-width=".6"/><text x="${x + 12}" y="${y + 14}" font-family="Arial,sans-serif" font-size="10" letter-spacing="1" fill="#607786">${view.toUpperCase()} VIEW</text>`; }); const size = V.sub(bounds.max, bounds.min).map(v => number(v, 2)).join(' × '); content += `<path d="M24 716h1075M752 716v54" fill="none" stroke="#314b5b"/><text x="43" y="738" font-family="Arial,sans-serif" font-size="11" fill="#314b5b">${escapeHTML(size)} mm overall · ${items.length} visible bodies</text><text x="43" y="757" font-family="Arial,sans-serif" font-size="9" fill="#647b89">Concept drawing. Views fitted independently; not to scale. Hidden edges are not removed.</text><text x="773" y="740" font-family="Arial,sans-serif" font-size="13" font-weight="bold" fill="#17495c">AXIOM CAD</text><text x="773" y="759" font-family="Arial,sans-serif" font-size="9" fill="#647b89">${new Date().toISOString().slice(0, 10)} · A3 landscape proportions</text></svg>`; return content; }
async function importFile(file) { if (!file)
    return; if (file.size > LIMITS.fileBytes) {
    toast('The file exceeds the 30 MB import safety limit.', true);
    return;
} try {
    const ext = file.name.split('.').at(-1).toLowerCase();
    if (ext === 'json' || ext === 'axiom') {
        const incoming = validateDocument(JSON.parse(await file.text()));
        commit('Open document', () => { doc = incoming; state.selected = []; state.selectedSketch = null; state.section = false; state.explode = 0; }, { fit: true });
        state.tab = 'Home';
        setTool('select');
        setView('iso');
        toast('Opened ' + incoming.name);
        return;
    }
    let vertices;
    if (ext === 'stl')
        vertices = parseSTL(await file.arrayBuffer());
    else if (ext === 'obj')
        vertices = parseOBJ(await file.text());
    else
        throw Error('Supported input formats are Axiom JSON, STL and OBJ.');
    openForm({ title: 'Import mesh', subtitle: file.name + ' · ' + number(vertices.length / 9) + ' triangles', symbol: 'mesh', fields: [{ key: 'name', label: 'Body name', type: 'text', value: file.name.replace(/\.[^.]+$/, ''), full: true }, { key: 'units', label: 'Source units', type: 'select', value: 'mm', options: [['mm', 'Millimeters'], ['in', 'Inches'], ['m', 'Meters']], full: true }], note: 'STL and OBJ generally do not define reliable length units. Choose the units used by the source model. Mesh topology is not automatically repaired or certified watertight.', submit: 'Import body', onApply: d => { const scale = d.units === 'in' ? 25.4 : d.units === 'm' ? 1000 : 1; const p = scale === 1 ? vertices : vertices.map(n => n * scale); validateShapeParameters('mesh', { vertices: p }); const b = newBody('mesh', { vertices: p }, { name: d.name, material: 'aluminum' }); commit('Import ' + ext.toUpperCase() + ' mesh', () => { doc.bodies.push(b); state.selected = [b.id]; state.selectedSketch = null; }, { fit: true }); setTool('select'); setView('iso'); } });
}
catch (e) {
    toast('Import failed: ' + e.message, true);
} }
function wireUI() {
    document.addEventListener('click', e => {
        const palette = e.target.closest('[data-palette-command]');
        if (palette) {
            const cmd = palette.dataset.paletteCommand;
            $('#modal').onkeydown = null;
            closeModal();
            runCommand(cmd);
            return;
        }
        const command = e.target.closest('[data-command]');
        if (command) {
            e.preventDefault();
            runCommand(command.dataset.command, command);
            return;
        }
        const tab = e.target.closest('[data-tab]');
        if (tab) {
            state.tab = tab.dataset.tab;
            renderRibbon();
            updateTitles();
            return;
        }
        const treeTabButton = e.target.closest('[data-tree-tab]');
        if (treeTabButton) {
            treeTab = treeTabButton.dataset.treeTab;
            $$('[data-tree-tab]').forEach(b => b.classList.toggle('active', b === treeTabButton));
            renderTree();
            return;
        }
        const group = e.target.closest('[data-toggle-group]');
        if (group) {
            const key = group.dataset.toggleGroup + 'Expanded';
            state[key] = !state[key];
            renderTree();
            return;
        }
        const exp = e.target.closest('[data-expand]');
        if (exp) {
            const id = exp.dataset.expand;
            state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
            renderTree();
            return;
        }
        const eye = e.target.closest('[data-eye]');
        if (eye) {
            const b = doc.bodies.find(b => b.id === eye.dataset.eye);
            commit('Toggle body visibility', () => b.visible = b.visible === false);
            return;
        }
        const sketchEye = e.target.closest('[data-sketch-eye]');
        if (sketchEye) {
            const s = doc.sketches.find(s => s.id === sketchEye.dataset.sketchEye);
            commit('Toggle sketch visibility', () => s.visible = !s.visible, { rebuild: false });
            return;
        }
        const body = e.target.closest('[data-body]');
        if (body) {
            chooseBody(body.dataset.body, e.shiftKey || e.metaKey || e.ctrlKey);
            return;
        }
        const sketch = e.target.closest('[data-sketch]');
        if (sketch) {
            chooseSketch(sketch.dataset.sketch);
            return;
        }
        const feature = e.target.closest('[data-feature-body]');
        if (feature) {
            chooseBody(feature.dataset.featureBody);
            editFeature(Number(feature.dataset.featureIndex));
            return;
        }
        const edit = e.target.closest('[data-edit-feature]');
        if (edit) {
            editFeature(Number(edit.dataset.editFeature));
            return;
        }
        const remove = e.target.closest('[data-remove-feature]');
        if (remove) {
            const b = requireBody();
            commit('Delete feature', () => b.features.splice(Number(remove.dataset.removeFeature), 1));
            return;
        }
        const swatch = e.target.closest('[data-swatch]');
        if (swatch) {
            const b = requireBody(), key = swatch.dataset.swatch;
            commit('Change material', () => { b.material = key; b.color = MATERIALS[key].color; }, { rebuild: false });
            return;
        }
        const plane = e.target.closest('[data-plane]');
        if (plane) {
            state.selectedSketch = null;
            beginSketch('rect', plane.dataset.plane);
            return;
        }
        const view = e.target.closest('[data-view]');
        if (view) {
            setView(view.dataset.view);
            return;
        }
        if (!e.target.closest('#menu'))
            $('#menu').classList.add('hidden');
    });
    $('#tree-filter').addEventListener('input', e => { state.filter = e.target.value; renderTree(); });
    $('#tree').addEventListener('dblclick', e => { const b = e.target.closest('[data-body]'); if (b) {
        chooseBody(b.dataset.body);
        runCommand('fit-selection');
    } const s = e.target.closest('[data-sketch]'); if (s) {
        chooseSketch(s.dataset.sketch);
        beginSketch();
    } });
    $('#inspector').addEventListener('change', e => { const input = e.target, b = selectedBody(); try {
        if (input.hasAttribute('data-document-name')) {
            commit('Rename document', () => doc.name = input.value.trim().slice(0, 120) || 'Untitled assembly', { rebuild: false });
            return;
        }
        if (input.hasAttribute('data-sketch-name')) {
            commit('Rename sketch', () => selectedSketch().name = input.value.trim().slice(0, 120) || 'Sketch', { rebuild: false });
            return;
        }
        if (input.dataset.sketchSize) {
            const s = selectedSketch(), v = Number(input.value) * scaleFactor(), bounds = profileBounds(s.points);
            commit('Resize sketch', () => resizeSketch(s, input.dataset.sketchSize === 'width' ? v : bounds.width, input.dataset.sketchSize === 'height' ? v : bounds.height));
            return;
        }
        if (!b)
            return;
        if (input.hasAttribute('data-body-name'))
            commit('Rename body', () => b.name = input.value.trim().slice(0, 120) || 'Body', { rebuild: false });
        else if (input.dataset.param) {
            const value = Number(input.value) * (input.dataset.unit === 'length' ? scaleFactor() : 1), params = { ...b.params, [input.dataset.param]: value };
            validateShapeParameters(b.kind, params);
            commit('Edit ' + input.dataset.param, () => b.params = params);
        }
        else if (input.dataset.transform) {
            let v = Number(input.value);
            const key = input.dataset.transform, index = Number(input.dataset.axisIndex);
            if (key === 'position')
                v *= scaleFactor();
            if (!Number.isFinite(v) || Math.abs(v) > 1e6)
                throw Error('Enter a finite value within ±1,000,000.');
            if (key === 'scale' && Math.abs(v) < .0001)
                throw Error('Scale cannot be zero.');
            commit('Edit ' + key, () => b[key][index] = v);
        }
        else if (input.hasAttribute('data-material'))
            commit('Change material', () => { b.material = input.value; b.color = MATERIALS[input.value].color; }, { rebuild: false });
        else if (input.hasAttribute('data-color'))
            commit('Change body color', () => b.color = input.value, { rebuild: false });
        else if (input.hasAttribute('data-feature-toggle'))
            commit('Toggle feature', () => b.features[Number(input.dataset.featureToggle)].suppressed = !input.checked);
    }
    catch (error) {
        toast(error.message, true);
        renderInspector();
    } });
    $('#file-input').addEventListener('change', e => { importFile(e.target.files[0]); e.target.value = ''; });
    $('#viewport').addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    $('#viewport').addEventListener('drop', e => { e.preventDefault(); importFile(e.dataTransfer.files[0]); });
    window.addEventListener('keydown', keyboard);
    $('.command-search').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        runCommand('search');
    } });
    $('#modal').addEventListener('close', () => { $('#modal').onkeydown = null; });
}
function editFeature(index) { const f = selectedBody()?.features[index]; if (f?.type === 'hole')
    holeDialog(index);
else if (f?.type === 'shell')
    shellDialog(index); }
function keyboard(e) { const target = e.target; if ($('#modal').open)
    return; if (target.matches('input,textarea,select') || target.isContentEditable) {
    if (e.key === 'Escape')
        target.blur();
    return;
} const cmd = e.ctrlKey || e.metaKey, key = e.key.toLowerCase(); if (cmd) {
    const map = { s: 'save', o: 'open', z: e.shiftKey ? 'redo' : 'undo', y: 'redo', d: 'duplicate', k: 'search' };
    if (map[key]) {
        e.preventDefault();
        runCommand(map[key]);
    }
    return;
} if (e.key === 'Escape') {
    $('#menu').classList.add('hidden');
    state.sketchDraft = null;
    state.sketchPolygon = [];
    state.selected = [];
    state.selectedSketch = null;
    state.section = false;
    state.explode = 0;
    state.tab = 'Home';
    state.measurement = [];
    setTool('select');
    refreshGPU();
    return;
} if (e.key === 'Enter' && state.tool === 'sketch' && state.sketchPolygon.length >= 3) {
    e.preventDefault();
    try {
        saveSketch(state.sketchPolygon, 'Polyline');
    }
    catch (error) {
        toast(error.message, true);
    }
    return;
} if (e.key === '/') {
    e.preventDefault();
    $('#tree-filter').focus();
    return;
} const map = { v: 'select', s: 'sketch', e: 'extrude', h: 'hole', m: 'move', d: 'measure', f: 'fit', g: 'grid', w: 'wireframe', c: 'section', r: 'rect', p: 'polygon', '0': 'iso', '1': 'front', '2': 'top', '3': 'right', '?': 'help', ' ': 'visibility', 'delete': 'delete', 'backspace': 'delete' }; if (map[key]) {
    e.preventDefault();
    runCommand(map[key]);
} }
function setupChrome() {
    $('#brand-icon').innerHTML = icon('logo', 25);
    $('#search-icon').innerHTML = icon('search', 14);
    $('#tree-search-icon').innerHTML = icon('search', 14);
    $('#empty-icon').innerHTML = icon('logo', 59);
    $('#doc-tab-icon').innerHTML = icon('cube', 14);
    $('#status-help').innerHTML = icon('help', 12);
    $('#title-actions').innerHTML = ['save', 'undo', 'redo', '|', 'export', '|', 'theme', 'help'].map(c => c === '|' ? '<span class="divider"></span>' : `<button class="icon-button" data-command="${c}" title="${commands[c].label}" aria-label="${commands[c].label}">${icon(commands[c].icon, 16)}</button>`).join('');
    $$('[data-command=toggle-properties]').forEach(b => b.innerHTML = icon(b.closest('.properties') ? 'close' : 'panel', 16));
    $('[data-command=collapse-tree]').innerHTML = icon('settings', 15);
    $('.document-tabs [data-command=new]').innerHTML = icon('plus', 15);
    renderUI();
}
async function boot() { setupChrome(); wireUI(); try {
    renderer = await Renderer.create($('#scene'), message => { toast('Graphics device issue: ' + message + ' Reload to recreate the renderer; your model is locally saved.', true); });
    $('#engine-badge').innerHTML = '<span></span>' + renderer.backend + ' · Ready';
    $('#engine-badge').classList.toggle('fallback', renderer.backend !== 'WebGPU');
    $('#engine-badge').title = renderer.backend === 'WebGPU' ? 'Native WebGPU · WGSL · 4× MSAA · Worker-generated geometry' : renderer.reason + ' · WebGL2 fallback';
    wirePointerEvents();
    connectWorker();
    new ResizeObserver(() => invalidate()).observe($('#viewport'));
    requestBuild();
    await whenIdle();
    invalidate();
}
catch (error) {
    console.error(error);
    $('#engine-badge').textContent = 'Renderer unavailable';
    $('#empty-state').classList.remove('hidden');
    $('#empty-state').innerHTML = '<h2>Graphics acceleration is unavailable.</h2><p>' + escapeHTML(error.message) + '</p><p>Open in a hardware-accelerated browser, using HTTPS or localhost for WebGPU.</p>';
    toast(error.message, true);
} }
window.axiom = { version: '0.1.0', getDocument: () => clone(doc), get renderer() { return renderer; }, get meshes() { return meshes; }, get camera() { return camera; }, get state() { return state; }, get history() { return history.slice(); }, get frameCount() { return frameCount; }, runCommand, whenIdle, select(ids) { state.selected = ids.filter(id => doc.bodies.some(b => b.id === id)); state.selectedSketch = null; renderUI(); }, selectSketch(id) { chooseSketch(id); }, loadSample, exportSVG: () => drawingSVG(exportItems()), importFile, validateDocument };
window.axiom.ready = boot();
