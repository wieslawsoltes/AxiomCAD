import { K } from './geometry.js';
self.onmessage = e => { const { revision, bodies } = e.data; const start = performance.now(); try {
    const items = K.buildScene(bodies);
    const transfers = items.flatMap(m => m.error ? [] : [m.vertices.buffer, m.edges.buffer]);
    self.postMessage({ revision, items, buildMs: performance.now() - start }, transfers);
}
catch (error) {
    self.postMessage({ revision, error: error.message });
} };
