import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {once} from 'node:events';

test('development server serves modules, limits paths and rejects writes', async () => {
 const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const child=spawn(process.execPath,[new URL('../serve.mjs',import.meta.url).pathname],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 try {
  await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('Server start timed out')),5000);t.unref();})]);
  const base=`http://127.0.0.1:${port}`;
  const index=await fetch(base);assert.equal(index.status,200);assert.match(await index.text(),/Axiom CAD/);
  const script=await fetch(base+'/src/app.js');assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/javascript/);assert.match(script.headers.get('content-security-policy'),/worker-src 'self' blob:/);
  const head=await fetch(base+'/styles.css',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal((await fetch(base+'/%2f..%2f..%2fetc%2fpasswd')).status,404);
  assert.equal((await fetch(base+'/',{method:'POST'})).status,405);
 } finally {child.kill('SIGTERM');await once(child,'exit');}
});
