// Real wheel scroll, usable width, DOM identity and collapse/unfold coverage.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs');
const {spawn}=require('node:child_process');
(async()=>{
 const server=spawn('python3',['-m','http.server','8006'],{cwd:path.resolve(__dirname,'..'),stdio:'ignore'});
 let browser;
 try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-gpu']});
  const page=await browser.newPage({viewport:{width:824,height:900},hasTouch:true,serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:8006');await page.locator('.welcome-btn').click();
  await page.evaluate(()=>{
   state.spells=Array.from({length:45},(_,i)=>({name:'Свиток '+i,level:1,description:'Строка описания.\n'.repeat(120),school:'Иллюзия'}));
   state.inventory=Array.from({length:45},(_,i)=>({name:'Артефакт '+i,qty:1,detail:{description:'Строка предмета.\n'.repeat(120)}}));
   state.features=Array.from({length:15},(_,i)=>({name:'Умение '+i,desc:'Описание\n'.repeat(30)}));
   document.getElementById('char-traits').value='До раскрытия';
   renderAll();saveAll();
  });
  const input=await page.locator('#char-traits').elementHandle();
  // The shell uses the entire viewport, and neither panel scrolls the other.
  for(const [width,height] of [[722,900],[800,900],[824,636],[900,900],[1024,768],[1536,1081],[852,393]]){
   await page.setViewportSize({width,height});
   const app=await page.locator('.app').boundingBox();
   assert.ok(app.width>=width-1,'Full display width');
   for(const kind of ['spells','inventory']){
    await page.evaluate(kind=>{activateTab(kind);uiOpen(kind,0);},kind);
    const left=page.locator(`#tab-${kind} .ui-master`),right=page.locator(`#tab-${kind} .ui-detail`);
    const lb=await left.boundingBox(),rb=await right.boundingBox();
    assert.ok(rb.x>=lb.x+lb.width-1,`${width}: visible right column`);
    assert.ok(rb.width>width*.4&&rb.x+rb.width<=width+1,`${kind} ${width}: ${JSON.stringify({lb,rb})}`);
    assert.ok(lb.height>100&&rb.height>100&&Math.abs(lb.height-rb.height)<2);
    await left.evaluate(el=>el.scrollTop=0);await right.evaluate(el=>el.scrollTop=0);
    await left.hover();await page.mouse.wheel(0,340);
    await page.waitForFunction(sel=>document.querySelector(sel).scrollTop>100,`#tab-${kind} .ui-master`);
    assert.equal(await right.evaluate(el=>el.scrollTop),0,'List wheel leaves detail fixed');
    const leftTop=await left.evaluate(el=>el.scrollTop);
    await right.hover();await page.mouse.wheel(0,340);
    await page.waitForFunction(sel=>document.querySelector(sel).scrollTop>100,`#tab-${kind} .ui-detail`);
    assert.equal(await left.evaluate(el=>el.scrollTop),leftTop,'Detail wheel leaves list fixed');
    assert.equal(await page.locator(`#tab-${kind} > .content`).evaluate(el=>el.scrollTop),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   }
  }
  // Character/combat/abilities/dice/journal keep two bounded scroll regions.
  await page.setViewportSize({width:824,height:900});
  for(const [tab,sub,selectors] of [
   ['character','main',['#char-main > .dual-pane:first-child','#char-main > .dual-pane:last-child']],
   ['character','combat',['.combat-vitals','.combat-actions']],
   ['character','abilities',['#char-abilities > .dual-pane:first-child','#char-abilities > .dual-pane:last-child']],
   ['dice',null,['#tab-dice > .content > .section:first-child','#tab-dice > .content > .section:last-child']],
   ['notes',null,['#tab-notes .dual-pane:first-child','#tab-notes .dual-pane:last-child']]
  ]){
   await page.evaluate(({tab,sub})=>{activateTab(tab);if(sub)switchSubtab('char',sub,document.querySelectorAll('#tab-character .subtab-btn')[['main','combat','abilities'].indexOf(sub)]);},{tab,sub});
   const bounds=await Promise.all(selectors.map(sel=>page.locator(sel).boundingBox()));
   assert.ok(bounds[0].width>300&&bounds[1].x>=bounds[0].x+bounds[0].width-1);
   for(const sel of selectors) assert.equal(await page.locator(sel).evaluate(el=>getComputedStyle(el).overflowY),'auto');
  }
  await page.evaluate(()=>{activateTab('character');switchSubtab('char','main',document.querySelector('#tab-character .subtab-btn'));});
  const left=page.locator('#char-main > .dual-pane:first-child'),right=page.locator('#char-main > .dual-pane:last-child');
  await right.hover();await page.mouse.wheel(0,350);
  await page.waitForFunction(()=>document.querySelector('#char-main > .dual-pane:last-child').scrollTop>100);
  assert.equal(await left.evaluate(el=>el.scrollTop),0);
  for(const [width,height] of [[393,852],[600,900],[720,900],[824,900]]){
   await page.setViewportSize({width,height});
   assert.ok(await input.evaluate(el=>el===document.getElementById('char-traits')));
   assert.equal(await page.locator('#char-traits').inputValue(),'До раскрытия');
   await page.evaluate(()=>{activateTab('spells');uiOpen('spells',4);});
   const wide=width-2>=720;
   assert.equal(await page.locator('#tab-spells .ui-master').isVisible(),wide);
   assert.equal(await page.locator('#spell-detail h2').textContent(),'Свиток 4');
  }
  const shots=process.env.REVIEW_SCREENSHOTS;
  if(shots){fs.mkdirSync(shots,{recursive:true});
   await page.evaluate(()=>{activateTab('character');switchSubtab('char','main',document.querySelector('#tab-character .subtab-btn'));});
   await page.screenshot({path:path.join(shots,'unfolded-hero.png')});
   await page.evaluate(()=>{activateTab('spells');uiOpen('spells',0);document.querySelector('#tab-spells .ui-master').scrollTop=0;document.querySelector('#spell-detail').scrollTop=0;});
   await page.screenshot({path:path.join(shots,'unfolded-spells.png')});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: 7 wide viewports, full screen width, actual independent wheel scrolling of spell/item lists and details, bounded hero/combat/abilities/dice/journal panes, narrow layouts, live resize and input identity. Chromium emulation; device Safari remains manual.');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
