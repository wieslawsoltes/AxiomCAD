import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('standalone build has valid classic JavaScript and no external runtime assets',()=>{
 execFileSync(process.execPath,[new URL('../build.mjs',import.meta.url).pathname]);
 const html=readFileSync(new URL('../dist/axiom-cad.html',import.meta.url),'utf8');
 const script=html.match(/<script>([\s\S]*)<\/script>/)?.[1];assert.ok(script);
 assert.doesNotThrow(()=>new vm.Script(script,{filename:'axiom-cad.html'}));
 assert.match(script,/AXIOM_WORKER_SOURCE/);assert.doesNotMatch(html,/<script[^>]+src=/);assert.doesNotMatch(html,/<link[^>]+href=["']https?:/);
});
