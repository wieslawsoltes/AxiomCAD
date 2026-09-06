import test from 'node:test';
import assert from 'node:assert/strict';
import {K} from '../src/geometry.js';
import {newBody,bearingSample,gearboxSample} from '../src/samples.js';
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<=t,`${a} ≠ ${b} (tolerance ${t})`);
const box=(w=10,d=20,h=30,extra={})=>newBody('box',{width:w,depth:d,height:h,radius:0},extra);
const volume=b=>K.packed(K.buildBody(b)).volume;

test('rectangular solid: analytic volume, area, bounds, 12 technical edges',()=>{
 const m=K.packed(K.buildBody(box()));near(m.volume,6000);near(m.area,2200);assert.deepEqual(m.bounds,{min:[-5,-10,0],max:[5,10,30]});assert.equal(m.edges.length/6,12);assert.equal(m.triangleCount,12);
});
test('concave extrusion and reversed winding yield the same volume',()=>{
 const p=[[0,0],[4,0],[4,1],[1,1],[1,4],[0,4]];
 for(const q of [p,[...p].reverse()])for(const height of [5,-5])near(K.packed(K.extrude(q,height)).volume,35);
});
test('degenerate and bow-tie profiles are rejected',()=>{
 assert.throws(()=>K.triangulate([[0,0],[1,0],[2,0]]));assert.throws(()=>K.triangulate([[0,0],[2,2],[0,2],[2,0]]));
});
test('polygon normal tolerates collinear leading vertices',()=>{
 const p=K.poly([[0,0,0],[1,0,0],[2,0,0],[2,2,0],[0,2,0]]);assert.ok(p);assert.deepEqual(p.n,[0,0,1]);
});
test('cylinder and tube match analytic polygonal volumes',()=>{
 const n=96,area=n/2*Math.sin(2*Math.PI/n);near(volume(newBody('cylinder',{radius:10,height:20,segments:n})),area*100*20,.00001);near(volume(newBody('tube',{radius:10,innerRadius:6,height:20,segments:n})),area*(100-36)*20,.00001);
});
test('sphere approximates analytic volume within one percent',()=>{
 near(volume(newBody('sphere',{radius:10})),4/3*Math.PI*1000,4/3*Math.PI*1000*.01);
});
test('partial revolutions preserve orientation and volume',()=>{
 for(const angle of [90,180,270,360]){const n=96,p=[[2,0],[10,0],[10,20],[2,20]];const expected=n/2*Math.sin(angle*Math.PI/180/n)*(100-4)*20;near(volume(newBody('revolve',{points:p,segments:n,angle})),expected,.00001);}
});
for(const [op,expected] of [['union',1500],['subtract',500],['intersect',500]])test('BSP '+op+' of overlapping cubes',()=>{
 const a=box(10,10,10),b=box(10,10,10,{position:[5,0,0]});near(K.packed(K.boolean(K.buildBody(a),K.buildBody(b),op)).volume,expected);
});
test('CSG coplanar interval sweep eliminates false T-junction feature edges',()=>{
 const a=box(10,10,10),b=box(10,10,10,{position:[5,0,0]});const m=K.packed(K.boolean(K.buildBody(a),K.buildBody(b),'union'));assert.equal(m.edges.length/6,12);
});
test('Boolean dependency snapshots retain operand transformations',()=>{
 const a=box(10,10,10),b=box(10,10,10,{position:[5,0,0]});near(volume(newBody('boolean',{a,b,operation:'union'})),1500);
});
test('negative scale and mirror preserve outward orientation',()=>{
 const a=box(10,10,10,{position:[20,0,0],scale:[-2,1,1]});near(volume(a),2000);const mirrored=newBody('mirror',{source:a,axis:'X',offset:0});const m=K.packed(K.buildBody(mirrored));near(m.volume,2000);near(m.bounds.min[0],-30);near(m.bounds.max[0],-10);
});
test('open-top shell subtracts the correct cavity',()=>{
 const a=box(20,30,40);a.features=[{type:'shell',params:{thickness:2}}];near(volume(a),20*30*40-16*26*38);
});
test('hole subtracts a polygonal cylinder and supports suppression',()=>{
 const a=box(20,20,10),n=64;a.features=[{type:'hole',params:{axis:'Z',x:0,y:0,z:-1,radius:2,depth:12,segments:n}}];near(volume(a),4000-n/2*Math.sin(2*Math.PI/n)*4*10,.00001);a.features[0].suppressed=true;near(volume(a),4000);
});
test('rounded boxes have lower volume than their bounding box',()=>{
 const a=box(20,20,10);a.params.radius=4;assert.ok(volume(a)<4000&&volume(a)>3800);
});
test('sample assemblies produce finite renderable geometry',()=>{
 for(const sample of [bearingSample(),gearboxSample()]){const result=K.buildScene(sample.bodies);assert.equal(result.length,sample.bodies.filter(x=>x.visible!==false).length);for(const m of result){assert.equal(m.error,undefined);assert.ok(m.triangleCount>0);assert.ok(m.volume>0&&Number.isFinite(m.volume));assert.ok(m.vertices.every(Number.isFinite));assert.ok(m.edges.every(Number.isFinite));}}
});
test('cache cannot retain stale feature parameters',()=>{
 const a=box();near(volume(a),6000);a.params.width=20;near(volume(a),12000);a.params.width=10;near(volume(a),6000);
});
