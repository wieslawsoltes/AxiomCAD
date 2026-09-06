"""Integration tests against the actual UI, worker and renderer.
Run: DISPLAY=:99 python tests/browser.py --inline
Or: python tests/browser.py --url http://localhost:8080
Requires Python Playwright and Chromium. No test dependency is shipped at runtime.
"""
import argparse, json, pathlib, time
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--inline',action='store_true');parser.add_argument('--url',default='http://localhost:8080');parser.add_argument('--chromium',default='/usr/bin/chromium');args=parser.parse_args()
def wait_until(page, expression, timeout=15000):
 # Poll through the automation protocol; do not relax the application's CSP.
 deadline = time.monotonic() + timeout / 1000
 while time.monotonic() < deadline:
  if page.evaluate(expression):
   return
  time.sleep(0.05)
 raise TimeoutError(f'Browser condition did not become true: {expression}')
reports=[];errors=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=browser.new_page(viewport={'width':1600,'height':1000},device_scale_factor=1)
 page.on('pageerror',lambda error:errors.append(str(error)))
 if args.inline: page.set_content((ROOT/'dist/axiom-cad.html').read_text(),wait_until='load')
 else: page.goto(args.url)
 wait_until(page,'window.axiom && window.axiom.renderer && !axiom.state.building',timeout=15000)
 def idle(): page.evaluate('()=>axiom.whenIdle()')
 def ev(script,arg=None): return page.evaluate(script,arg)
 def cmd(name): ev('(name)=>axiom.runCommand(name)',name)
 def submit(values={}):
  for k,v in values.items():
   loc=page.locator('#field-'+k)
   if loc.evaluate('(e)=>e.tagName')=='SELECT':loc.select_option(str(v))
   else:loc.fill(str(v))
  page.locator('#active-form button[type=submit]').click()
  wait_until(page,'!document.querySelector("#modal").open')
  idle()
 def check(name,condition):
  assert condition,name
  reports.append({'name':name,'passed':True});print('PASS',name,flush=True)
 def body_doc(bodies=[],sketches=[]):return {'schema':'axiom-cad','version':1,'name':'Integration model','units':'mm','bodies':bodies,'sketches':sketches}
 def box(id='box',x=0):return {'id':id,'name':id,'kind':'box','params':{'width':10,'depth':10,'height':10,'radius':0},'position':[x,0,0]}
 def load(d):ev('(d)=>axiom.importFile(new File([JSON.stringify(d)],"test.axiom.json",{type:"application/json"}))',d);idle()
 def select(id):ev('(id)=>axiom.select([id])',id)
 def world_click(point):
  xy=ev('(p)=>{const q=axiom.camera.project(p),r=axiom.renderer.canvas.getBoundingClientRect();return [q[0]+r.left,q[1]+r.top]}',point)
  page.mouse.click(*xy)
  return xy
 def volume(id):return ev('(id)=>axiom.meshes.find(m=>m.id===id).volume',id)
 try:
  check('sample builds 14 real bodies',ev('axiom.meshes.length===14 && axiom.meshes.every(m=>m.vertices.length>0)'))
  # The unselected initial screenshot is also the product preview.
  page.mouse.move(5,5);page.wait_for_timeout(100);page.screenshot(path=str(ROOT/'docs/preview.png'))
  page.wait_for_timeout(500);frames=ev('axiom.frameCount');page.wait_for_timeout(250)
  check('renderer sleeps without an idle animation loop',ev('axiom.frameCount')==frames)
  first=ev('axiom.getDocument().bodies[0].id');select(first);before=volume(first)
  page.locator('#param-width').fill('160');page.locator('#param-width').press('Tab');idle()
  check('inspector edits rebuild a solid',volume(first)>before)
  cmd('undo');idle();check('Undo restores geometric volume',abs(volume(first)-before)<1e-6)
  cmd('redo');idle();check('Redo restores edited parameter',ev('axiom.getDocument().bodies[0].params.width')==160)
  select(first);page.locator('#param-width').fill('-4');page.locator('#param-width').press('Tab');idle()
  check('invalid dimension is rejected',ev('axiom.getDocument().bodies[0].params.width')==160)
  page.locator('[data-material]').select_option('brass');idle()
  check('material selection updates the document and GPU batch',ev('axiom.getDocument().bodies[0].material==="brass" && axiom.renderer.drawItems[0].body.material==="brass"'))
  cmd('box');submit({'name':'Test block','width':30,'depth':40,'height':20,'radius':0,'x':180,'z':0})
  bid=ev('axiom.state.selected[0]');check('ribbon primitive dialog creates real geometry',abs(volume(bid)-24000)<.001)
  cmd('hole');submit({'radius':3,'depth':25,'axis':'Z','x':0,'y':0,'z':-1})
  check('hole dialog cuts actual material',23000<volume(bid)<24000)
  check('hole is retained as an editable feature',ev('axiom.getDocument().bodies.at(-1).features[0].type==="hole"'))
  # Actual canvas picking, move and measurement on a known simple test body.
  load(body_doc([box()]));cmd('top');page.wait_for_timeout(100);world_click([0,0,10])
  check('ray picking selects the rendered body',ev('axiom.state.selected[0]')=='box')
  cmd('move');page.wait_for_timeout(100)
  q=ev('(()=>{const p=axiom.camera.project([2,2,10]),r=axiom.renderer.canvas.getBoundingClientRect();return [p[0]+r.left,p[1]+r.top]})()')
  page.mouse.move(*q);page.mouse.down();page.mouse.move(q[0]+80,q[1]+40,steps=6);page.mouse.up();idle()
  check('pointer drag moves the body in model space',ev('axiom.getDocument().bodies[0].position.some(x=>Math.abs(x)>0.1)'))
  cmd('undo');idle();cmd('select');cmd('measure');world_click([-3,-3,10]);world_click([3,3,10])
  check('surface picking measures two points',ev('axiom.state.measurement.length')==2)
  check('measurement result is a finite nonzero distance',ev('Math.hypot(...axiom.state.measurement[0].map((v,i)=>v-axiom.state.measurement[1][i]))')>8)
  cmd('select');cmd('section');check('section generates actual triangle-plane contours',ev('axiom.renderer.sectionCount')>0)
  cmd('section');cmd('explode');check('exploded view changes GPU instance positions only',ev('axiom.state.explode>0 && axiom.renderer.drawItems[0].offset.some(x=>x!==0) && axiom.getDocument().bodies[0].position.every(x=>x===0)'))
  cmd('explode');cmd('wireframe');check('wireframe changes the rendering mode',ev('axiom.state.mode')==2)
  cmd('shaded-edges');cmd('theme');check('dark theme switches the UI',page.locator('html').get_attribute('data-theme')=='dark')
  cmd('theme');cmd('perspective');check('perspective projection is active',ev('axiom.camera.perspective'))
  cmd('perspective')
  # Sketch is drawn with real pointer events; extrusion remains associative.
  load(body_doc());cmd('rect');page.wait_for_timeout(100)
  r=page.locator('#scene').bounding_box();x=r['x']+r['width']*.52;y=r['y']+r['height']*.53
  page.mouse.move(x-100,y-65);page.mouse.down();page.mouse.move(x+100,y+65,steps=10);page.mouse.up();idle()
  check('rectangle pointer tool creates a closed sketch',ev('axiom.getDocument().sketches.length===1 && axiom.getDocument().sketches[0].points.length===4'))
  sid=ev('axiom.getDocument().sketches[0].id');cmd('extrude');submit({'height':25});eid=ev('axiom.state.selected[0]');before=volume(eid)
  check('sketch extrusion produces nonempty geometry',before>1000)
  ev('(id)=>axiom.selectSketch(id)',sid);cmd('sketch-size');submit({'width':80,'height':50});check('sketch dimensions regenerate linked extrusion',abs(volume(eid)-80*50*25)<.01)
  # Deleting the source sketch must freeze the last valid profile.
  ev('(id)=>axiom.selectSketch(id)',sid);cmd('delete');idle()
  check('deleting a sketch freezes its latest profile in the extrusion',ev('axiom.getDocument().sketches.length===0 && !axiom.getDocument().bodies[0].params.sketchId') and abs(volume(eid)-100000)<.01)
  cmd('undo');idle();check('Undo restores sketch association',ev('axiom.getDocument().sketches.length===1 && !!axiom.getDocument().bodies[0].params.sketchId'))
  # Boolean operands remain in the tree and can be recovered by Undo.
  load(body_doc([box('a'),box('b',5)]));ev('axiom.select(["a","b"])');cmd('union');idle();uid=ev('axiom.state.selected[0]')
  check('Boolean union generates the expected volume',abs(volume(uid)-1500)<.001)
  check('Boolean operands are retained but hidden',ev('axiom.getDocument().bodies.length===3 && axiom.meshes.length===1'))
  cmd('undo');idle();check('Boolean undo restores operands',ev('axiom.meshes.length===2 && axiom.getDocument().bodies.length===2'))
  select('a');cmd('linear');submit({'count':3,'spacing':20,'axis':'X'});check('linear pattern produces independent bodies',ev('axiom.getDocument().bodies.length')==4)
  cmd('undo');idle();select('a');cmd('circular');submit({'count':4,'angle':360,'x':20,'y':0});check('circular pattern produces independent bodies',ev('axiom.getDocument().bodies.length')==5)
  cmd('undo');idle();select('b');cmd('mirror');submit({'axis':'X','offset':0});mid=ev('axiom.state.selected[0]')
  check('mirror changes geometry across the selected plane',ev('(id)=>axiom.meshes.find(m=>m.id===id).bounds.max[0]',mid)<=.001)
  select('a');cmd('isolate');idle();check('isolation changes renderable body visibility',ev('axiom.meshes.length')==1)
  cmd('show-all');idle();check('show all restores hidden bodies',ev('axiom.meshes.length')==3)
  # SVG is parsed as XML; PNG is produced from the real render canvas.
  check('SVG export creates a valid three-view document',ev('(()=>{const xml=new DOMParser().parseFromString(axiom.exportSVG(),"image/svg+xml");return !xml.querySelector("parsererror") && xml.querySelectorAll("clipPath").length===3})()'))
  check('PNG capture contains an actual raster payload',ev('axiom.renderer.canvas.toDataURL("image/png").length')>10000)
  serialized=ev('axiom.getDocument()');load(serialized);check('native JSON reload retains geometry',ev('axiom.meshes.length')==3)
  # Input import through the real parser and unit selector.
  ev('(s)=>axiom.importFile(new File([s],"triangle.obj"))','v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3')
  submit({'units':'in'});check('OBJ import applies the selected source units',ev('Math.abs(axiom.meshes.at(-1).bounds.max[0]-25.4)<0.001'))
  page.locator('#scene').focus();page.keyboard.press('Control+k');page.locator('#palette-input').fill('sphere');check('command palette filters real commands',page.locator('[data-palette-command="sphere"]').count()==1)
  page.locator('[data-palette-command="sphere"]').click();check('command palette dispatches a modeling dialog',page.locator('#modal h2').inner_text()=='Create sphere');page.locator('[data-close-modal]').first.click()
  cmd('sample-bearing');idle();cmd('theme');page.mouse.move(5,5);page.wait_for_timeout(3700);page.screenshot(path=str(ROOT/'docs/preview-dark.png'))
  page.set_viewport_size({'width':1100,'height':800});page.wait_for_timeout(100);check('workspace fits a smaller desktop viewport',ev('document.documentElement.scrollWidth<=innerWidth'))
  check('no uncaught JavaScript errors',not errors)
 finally:
  result={'backend':ev('axiom.renderer?.backend'),'navigation':'inline about:blank' if args.inline else args.url,'tests':reports,'errors':errors,'browser':browser.version,'passed':len(reports)}
  (ROOT/'docs/browser-test-results.json').write_text(json.dumps(result,indent=2))
  if errors:print('ERRORS',errors)
  browser.close()
print(f'{len(reports)} integration checks passed.')
