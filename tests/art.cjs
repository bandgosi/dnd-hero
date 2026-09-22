// v41 asset, class, portrait and offline regression checks.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const server=require('child_process').spawn('python3',['-m','http.server','8002'],{cwd:path.resolve(__dirname,'..'),stdio:'ignore'});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-gpu']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('APP ERROR:',e.message);});
  await page.goto('http://localhost:8002');
  await page.waitForFunction(async()=>navigator.serviceWorker.controller&&(await caches.keys()).includes('dnd-hero-v42'));
  await page.waitForLoadState('networkidle');await page.waitForFunction(()=>typeof artApplyClass==='function'&&document.querySelector('.hero-overview'));await page.locator('.welcome-btn').click();
  await page.evaluate(()=>localStorage.setItem('fx_sound','0'));
  const assets=await page.evaluate(async()=>{
    const cache=await caches.open('dnd-hero-v42');
    return Promise.all(['art-v41.css','art-v41.js','images/art/classes.webp','images/art/grimoire.webp','images/art/halfling.webp','images/art/items.webp'].map(async p=>!!await cache.match(new URL(p,location.href).href)));
  });assert.ok(assets.every(Boolean),'All artwork/code must be available offline');
  const classes=await page.evaluate(()=>ART_CLASS_ORDER);
  const positions=[];
  for(const cls of classes){
    await page.locator('#char-class').selectOption(cls);
    assert.equal(await page.locator('.class-cover').getAttribute('data-class'),cls);
    positions.push(await page.locator('.class-cover').evaluate(e=>e.style.backgroundPosition));
  }
  assert.equal(new Set(positions).size,12);
  await page.locator('#char-class').selectOption('Колдун');
  await page.getByRole('button',{name:'Выбрать портрет',exact:true}).click();
  await page.getByRole('button',{name:'Портрет полурослика',exact:true}).click();
  assert.equal(await page.evaluate(()=>state.portrait),'gallery-halfling');
  await page.reload();await page.waitForLoadState('networkidle');await page.waitForFunction(()=>typeof artApplyClass==='function'&&document.querySelector('.hero-overview'));await page.locator('.welcome-btn').click();
  await page.waitForFunction(()=>document.getElementById('portrait-img').naturalWidth>0);
  assert.equal(await page.evaluate(()=>state.portrait),'gallery-halfling');
  // Existing uploaded portrait wins over the built-in gallery choice.
  const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  await page.evaluate(photo=>{state.portraitImg=photo;renderPortrait();saveAll();},photo);
  assert.equal(await page.locator('#portrait-img').getAttribute('src'),photo);
  await page.reload();await page.waitForLoadState('networkidle');await page.waitForFunction(()=>typeof artApplyClass==='function'&&document.querySelector('.hero-overview'));await page.locator('.welcome-btn').click();
  assert.equal(await page.evaluate(()=>state.portraitImg),photo);
  await page.evaluate(()=>pickPortraitEmoji('gallery-halfling'));
  await page.getByRole('button',{name:'Магия',exact:true}).click();
  assert.equal(await page.locator('#spell-list .school-symbol').count(),await page.locator('#spell-list .spell-row').count());
  const before=await page.evaluate(()=>state.hp.current);
  await page.evaluate(()=>{changeHP(-1);activateTab('character');});
  assert.equal(await page.locator('.overview-title b').textContent(),String(before-1));
  await page.evaluate(()=>{state.inventory.push({name:'Кольцо проверки',qty:1,detail:{rarity:'Легендарный',description:'Проверка оформления'}});renderInventory();activateTab('inventory');uiOpen('inventory',state.inventory.length-1);});
  assert.ok(await page.locator('#inventory-detail').evaluate(e=>e.classList.contains('rarity-legendary')));
  assert.equal(await page.locator('#inventory-detail .item-illustration').count(),1);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{document.querySelectorAll('.art-pulse,.art-heal,.art-damage,.art-critical').forEach(e=>e.classList.remove('art-pulse','art-heal','art-damage','art-critical'));artPulse(document.querySelector('.hp-section'));});
  assert.equal(await page.locator('.art-pulse').count(),0);
  await context.setOffline(true);
  await page.reload();await page.waitForLoadState('networkidle');await page.waitForFunction(()=>typeof artApplyClass==='function'&&document.querySelector('.hero-overview'));await page.locator('.welcome-btn').click();
  await page.getByRole('button',{name:'Магия',exact:true}).click();
  await page.getByRole('button',{name:'Мистический заряд: открыть',exact:true}).click();
  assert.equal(await page.locator('#spell-detail .school-symbol').count(),1);
  assert.ok(await page.evaluate(()=>typeof artApplyClass==='function'));
  assert.deepEqual(errors,[]);
  if(process.env.REVIEW_SCREENSHOTS){
    const dir=path.resolve(process.env.REVIEW_SCREENSHOTS);fs.mkdirSync(dir,{recursive:true});
    await page.evaluate(()=>activateTab('character'));
    await page.screenshot({path:path.join(dir,'phone-hero-art.png')});
    await page.evaluate(()=>activateTab('spells'));await page.getByRole('button',{name:'‹ Заклинания',exact:true}).click();
    await page.screenshot({path:path.join(dir,'phone-spells-art.png')});
    await page.evaluate(()=>{activateTab('inventory');const i=state.inventory.findIndex(it=>/Зелье/.test(it.name));uiOpen('inventory',i);});
    await page.screenshot({path:path.join(dir,'phone-item-art.png')});
    await page.setViewportSize({width:900,height:900});await page.evaluate(()=>activateTab('character'));
    await page.screenshot({path:path.join(dir,'fold-hero-art.png')});
  }
  console.log('PASS: 12 class covers, gallery/custom portrait persistence, school icons, overview sync, rarity, reduced motion, all new assets precached and app usable offline.');
 }finally{await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
