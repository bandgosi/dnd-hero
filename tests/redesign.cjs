// Functional regression coverage for the v40 master/detail redesign.
// CHROMIUM_EXECUTABLE=/path/to/chrome node tests/redesign.cjs
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
(async()=>{
 const server=require('child_process').spawn('python3',['-m','http.server','8001'],{cwd:path.resolve(__dirname,'..'),stdio:'ignore'});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-gpu']});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:8001');await page.locator('.welcome-btn').click();
  await page.evaluate(()=>{localStorage.setItem('fx_sound','0');saveAll();});
  const original=await page.evaluate(()=>localStorage.getItem(STORE_KEY));
  await page.reload();await page.locator('.welcome-btn').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('dnd_backup_before_v40')),original);
  await page.getByRole('button',{name:'Магия',exact:true}).click();
  await page.locator('#spells-search').fill('заряд');
  assert.equal(await page.locator('.spell-row').count(),1);
  await page.locator('.spell-row').click();
  assert.equal(await page.locator('#spell-detail h2').textContent(),'Мистический заряд');
  assert.equal(await page.locator('#spells-search').isVisible(),false);
  const slots=await page.evaluate(()=>JSON.stringify(state.spellSlots));
  const history=await page.evaluate(()=>state.rollHistory.length);
  await page.getByRole('button',{name:/Бросить атаку/}).click();
  assert.equal(await page.evaluate(()=>state.rollHistory.length),history+1);
  assert.equal(await page.evaluate(()=>JSON.stringify(state.spellSlots)),slots);
  await page.getByRole('button',{name:'‹ Заклинания',exact:true}).click();
  assert.equal(await page.locator('#spells-search').inputValue(),'заряд');
  await page.locator('#spells-search').fill('');
  const countBefore=await page.locator('#spell-slots-grid .available').count();
  await page.locator('#spell-slots-grid .available').first().click();
  assert.equal(await page.locator('#spell-slots-grid .available').count(),countBefore-1);
  await page.getByRole('button',{name:'Сглаз: открыть',exact:true}).click();
  await page.getByRole('button',{name:'Концентрироваться',exact:true}).click();
  assert.equal(await page.evaluate(()=>state.concentrationSpell),'Сглаз');
  const wasPrepared=await page.evaluate(()=>state.spells.find(s=>s.name==='Сглаз').prepared);
  await page.getByRole('button',{name:wasPrepared?'✓ Подготовлено':'Подготовить',exact:true}).click();
  assert.equal(await page.evaluate(()=>state.spells.find(s=>s.name==='Сглаз').prepared),!wasPrepared);
  await page.setViewportSize({width:900,height:900});
  assert.equal(await page.locator('#spells-search').isVisible(),true);
  assert.equal(await page.locator('#spell-detail').isVisible(),true);
  // Selected detail survives folding/unfolding.
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('#spell-detail h2').textContent(),'Сглаз');
  await page.getByRole('button',{name:'Сумка',exact:true}).click();
  await page.locator('#inventory-search').fill('кинжал');
  await page.locator('.inventory-row').click();
  const qty=await page.evaluate(()=>state.inventory.find(i=>/Кинжал/i.test(i.name)).qty);
  await page.getByRole('button',{name:'Увеличить количество',exact:true}).click();
  assert.equal(await page.evaluate(()=>state.inventory.find(i=>/Кинжал/i.test(i.name)).qty),qty+1);
  await page.getByRole('button',{name:'‹ Снаряжение',exact:true}).click();
  assert.equal(await page.locator('#inventory-search').inputValue(),'кинжал');
  await page.reload();await page.locator('.welcome-btn').click();
  assert.equal(await page.evaluate(()=>state.inventory.find(i=>/Кинжал/i.test(i.name)).qty),qty+1);
  assert.equal(await page.evaluate(()=>state.concentrationSpell),'Сглаз');
  assert.equal(await page.evaluate(()=>localStorage.getItem('dnd_backup_before_v40')),original);
  // Arbitrary names and long descriptions stay text, never executable markup.
  await page.evaluate(()=>{
    state.spells.push({name:'<img src=x onerror="window.injected=true">',level:9,description:'Очень длинный текст '.repeat(80)});
    state.inventory.push({name:'<svg onload="window.injected=true">',qty:1,detail:{description:'Длинное описание '.repeat(80)}});
    renderSpellList();renderInventory();
  });
  for(const [w,h] of [[320,780],[390,844],[719,900],[720,900],[900,800],[1440,900],[800,360]]){
    await page.setViewportSize({width:w,height:h});
    for(const kind of ['spells','inventory']){
      await page.evaluate(kind=>{activateTab(kind);uiOpen(kind,(kind==='spells'?state.spells:state.inventory).length-1);},kind);
      const overflow=await page.evaluate(()=>[...document.querySelectorAll('.content,.ui-workspace,.ui-detail,.ui-master')].filter(e=>e.getBoundingClientRect().width).filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>e.className));
      assert.deepEqual(overflow,[],`${kind} overflow at ${w}x${h}`);
    }
  }
  assert.equal(await page.evaluate(()=>window.injected),undefined);
  // Switching characters resets view-only selection and leaves no stale detail.
  await page.evaluate(()=>applyCharacter(blankCharacterData()));
  assert.equal(await page.locator('.spell-row').count(),0);
  assert.equal(await page.locator('.inventory-row').count(),0);
  assert.equal(await page.locator('#inventory-search').inputValue(),'');
  assert.deepEqual(errors,[]);
  // Optional review images are generated from the real app, not image mockups.
  if(process.env.REVIEW_SCREENSHOTS){
    const dir=path.resolve(process.env.REVIEW_SCREENSHOTS);fs.mkdirSync(dir,{recursive:true});
    await page.evaluate(()=>{loadDefaultCharacter();syncSpellSlots();renderAll();activateTab('spells');});
    for(const [name,width,height] of [['phone',390,844],['fold',900,900]]){
      await page.setViewportSize({width,height});await page.evaluate(()=>uiBack('spells'));
      await page.screenshot({path:path.join(dir,name+'-spells.png')});
      await page.getByRole('button',{name:'Мистический заряд: открыть',exact:true}).click();
      await page.screenshot({path:path.join(dir,name+'-spell-detail.png')});
    }
    await page.evaluate(()=>activateTab('character'));
    await page.getByRole('button',{name:'Основное',exact:true}).click();
    await page.screenshot({path:path.join(dir,'fold-hero.png')});
    await page.getByRole('button',{name:'Бой',exact:true}).click();
    await page.screenshot({path:path.join(dir,'fold-combat.png')});
  }
  console.log('PASS: search/filter/detail navigation, resize, spell rolls, slots, preparation, concentration, inventory, persistence, backup, character switching, long/unsafe text, no JS errors.');
 } finally {await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
