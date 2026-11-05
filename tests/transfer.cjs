// Complete backup/download/import coverage in two isolated device contexts.
// NODE_PATH=/path/to/node_modules CHROMIUM_EXECUTABLE=/path/to/chrome node tests/transfer.cjs
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {spawn}=require('node:child_process');
(async()=>{
 const server=spawn('python3',['-m','http.server','8005'],{cwd:path.resolve(__dirname,'..'),stdio:'ignore'});
 let browser;
 try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-gpu']});
  const old=await browser.newContext({viewport:{width:430,height:932},hasTouch:true});
  const fresh=await browser.newContext({viewport:{width:824,height:900},hasTouch:true});
  const source=await old.newPage(),target=await fresh.newPage(),errors=[];
  for(const page of [source,target])page.on('pageerror',e=>errors.push(e.message));
  const open=async page=>{await page.goto('http://localhost:8005');await page.locator('.welcome-btn').click();};
  await open(source);await open(target);
  const fixtures=await source.evaluate(()=>{
   const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
   const list=['Звиад','Лука','Давид'].map((name,i)=>{
    const data=blankCharacterData(),s=data.state,f=data.fields;
    Object.assign(f,{'char-name':name,'char-class':'Колдун','char-subclass':'Великий Древний','char-level':'6','char-race':'Полурослик','char-bg':'Отшельник','char-xp':'14000','char-traits':'Черты 🐉\nВторая строка','stat-ac':'15','stat-speed':'25','temp-hp':String(i),'coin-gp':String(100+i),'notes-campaign':'Сессия №'+i+'\nСекреты <и> планы','notes-npc':'Маг «Эльминстер»','notes-locations':'Глубоководье','notes-misc':'Разное 🎲'});
    Object.assign(s,{abilities:[8+i,16,13,10,12,18],hp:{current:i===0?0:31+i,max:42},tempHP:i,portraitImg:photo,portrait:'gallery-halfling',inspiration:true,skillProfs:Array.from({length:SKILLS_DATA.length},(_,j)=>j%2===0),saveProfs:[false,false,false,false,true,true],conditions:['Концентрация'],dsSuccess:[i===0,false,false],dsFailure:[false,i===0,false],diceCount:2,hitDice:{total:6,used:2,die:8},concentrationSpell:'Сглаз',bonusSlots:[1,0,0,0,0,0,0,0,0],spellSlots:Array.from({length:9},(_,j)=>({level:j+1,base:j===2?2:0,total:j===0?1:j===2?2:0,used:j===2?1:0})),spells:[{name:'Мистический заряд',level:0,description:'Дальний бой: атака заклинанием.',school:'Воплощение',castingTime:'1 действие',range:'120 футов',components:'В, С',duration:'Мгновенно',damage:'1к10'},{name:'Сглаз',level:1,prepared:true,description:'Проклятие',concentration:true}],inventory:[{name:'Кольцо',qty:1,attuned:true,equipped:true,detail:{description:'Личное кольцо\nВторая строка',rarity:'Редкий',properties:['Настройка']}},{name:'Зелье',qty:3,equipped:false,detail:{description:'Лечение'}}],attacks:[{name:'Кинжал',bonus:6,damage:'1к4+3'}],resources:[{name:'Заряды',max:3,used:1,recover:'short'}],features:[{name:'Удача',desc:'Переброс',collapsed:true}],rollHistory:[{label:'Проверка <img src=x onerror="window.injected=true">',total:23,rolls:[17],modVal:6,isCrit:false,isFail:false,time:'12:34'}]});
    return {id:'test-'+i,name,data};
   });
   setStore({active:'test-1',list});applyCharacter(list[1].data);saveAll();
   // Capture the post-normalization active character and every inactive record.
   return getStore();
  });
  // Include a change that has not yet reached the autosave timer.
  await source.locator('#notes-campaign').evaluate(el=>el.value+='\nПеред переносом');
  const downloadEvent=source.waitForEvent('download');
  assert.equal(await source.evaluate(()=>exportCharacters()),true);
  const download=await downloadEvent;
  assert.match(download.suggestedFilename(),/^dnd-герои-.*\.json$/);
  const json=await fs.readFile(await download.path(),'utf8'),backup=JSON.parse(json);
  fixtures.list[1].data.fields['notes-campaign']+='\nПеред переносом';
  assert.equal(backup.backup.count,3);assert.match(backup.backup.checksum,/^[a-f0-9]{64}$/);
  assert.deepEqual({active:backup.active,list:backup.list},fixtures);
  assert.deepEqual(backup.list.map(c=>c.data.state.portraitImg),fixtures.list.map(c=>c.data.state.portraitImg));
  const importJSON=(page,text)=>page.evaluate(text=>importCharacters(new File([text],'heroes.json',{type:'application/json'})),text);
  const raw=page=>page.evaluate(()=>localStorage.getItem(STORE_KEY));
  const initial=JSON.parse(await raw(target));
  assert.equal(await importJSON(target,json),true);
  let store=JSON.parse(await raw(target));
  assert.equal(store.list.length,4);assert.equal(store.active,fixtures.active);
  for(const c of fixtures.list)assert.deepEqual(store.list.find(x=>x.id===c.id).data,c.data);
  // Full UI application of every hero, then real reload with the service worker offline.
  for(const c of fixtures.list){
   await target.evaluate(id=>switchCharacter(id),c.id);
   assert.equal(await target.locator('#char-name').inputValue(),c.name);
   assert.equal(await target.locator('#notes-misc').inputValue(),c.data.fields['notes-misc']);
   assert.equal(await target.locator('#portrait-img').getAttribute('src'),c.data.state.portraitImg);
   await target.waitForFunction(()=>document.getElementById('portrait-img').naturalWidth>0);
   assert.equal(await target.evaluate(()=>saveAll()),true);
  }
  await target.waitForFunction(async()=>navigator.serviceWorker.controller&&(await caches.keys()).includes('dnd-hero-v49'));
  await target.waitForLoadState('networkidle');
  const beforeReload=await raw(target);
  await fresh.setOffline(true);await target.reload();await target.locator('.welcome-btn').click();
  assert.equal(await raw(target),beforeReload);
  assert.equal(await target.locator('#char-name').inputValue(),'Давид');
  const reexportEvent=target.waitForEvent('download');assert.equal(await target.evaluate(()=>exportCharacters()),true);
  const restoredBackup=JSON.parse(await fs.readFile(await (await reexportEvent).path(),'utf8'));
  for(const c of fixtures.list)assert.deepEqual(restoredBackup.list.find(x=>x.id===c.id).data,c.data);
  assert.equal(await importJSON(target,json),true);assert.equal((JSON.parse(await raw(target))).list.length,4);
  assert.match(await target.locator('#toast').textContent(),/уже импортированы/);
  // An edited local character survives repeated import without duplicate creation.
  await target.evaluate(()=>{document.getElementById('notes-misc').value='Новый прогресс';saveAll();});
  assert.equal(await importJSON(target,json),true);
  assert.equal((JSON.parse(await raw(target))).list.length,4);
  assert.equal(await target.locator('#notes-misc').inputValue(),'Новый прогресс');
  const stable=await raw(target);
  // Corrupt/truncated JSON, checksum tampering, empty list, invalid second entry,
  // prototype keys, bad nested types, unknown versions, invalid active id.
  const bad=JSON.parse(json);bad.list[0].name='Изменён';
  const broken=[json.slice(0,-30),JSON.stringify(bad),'null','{"list":[]}',
   JSON.stringify({active:'a',list:[{id:'a',name:'A',data:fixtures.list[0].data},{id:'b',name:'B',data:{state:{inventory:[null]}}}]}),
   '{"__proto__":{},"fields":{}}',JSON.stringify({...backup,backup:{...backup.backup,version:999}}),
   JSON.stringify({active:'missing',list:fixtures.list}),JSON.stringify({active:'a',list:[{id:'a',name:'A',data:{state:{spells:[{name:'x',description:{}}]}}}]})];
  for(const text of broken){assert.equal(await importJSON(target,text),false);assert.equal(await raw(target),stable);}
  assert.equal(await target.evaluate(()=>importCharacters(new File([],'empty.json'))),false);
  assert.equal(await target.evaluate(()=>importCharacters(new File([new Uint8Array(MAX_BACKUP_BYTES+1)],'big.json'))),false);
  assert.equal(await target.evaluate(()=>importCharacters({size:100,text:()=>Promise.reject(new Error('iCloud unavailable'))})),false);
  // Older full backups and single-character data remain importable/idempotent.
  const legacy=JSON.stringify({active:fixtures.active,list:fixtures.list});
  assert.equal(await importJSON(target,legacy),true);
  assert.equal((JSON.parse(await raw(target))).list.length,4);
  const single=JSON.stringify({fields:{'char-name':'Старый герой','notes-misc':'Не терять'}});
  assert.equal(await importJSON(target,single),true);
  assert.equal(await target.locator('#notes-misc').inputValue(),'Не терять');
  assert.equal(await target.locator('#notes-campaign').inputValue(),''); // No fields leak from previous hero.
  const singleCount=(JSON.parse(await raw(target))).list.length;
  assert.equal(await importJSON(target,single),true);assert.equal((JSON.parse(await raw(target))).list.length,singleCount);
  // Colliding ids preserve local data and add the differing record exactly once.
  const collision=JSON.stringify({active:fixtures.active,list:[{...fixtures.list[1],name:'Другая версия'}]});
  const local=JSON.parse(await raw(target)).list.find(c=>c.id===fixtures.active);
  assert.equal(await importJSON(target,collision),true);
  store=JSON.parse(await raw(target));assert.deepEqual(store.list.find(c=>c.id===fixtures.active),local);
  assert.equal(store.list.length,singleCount+1);
  assert.equal(await importJSON(target,collision),true);assert.equal(JSON.parse(await raw(target)).list.length,store.list.length);
  // Quota/security failures: no success, no partial commit, same active UI.
  const addFile=JSON.stringify({fields:{'char-name':'Не записан'}});
  for(const errorName of ['QuotaExceededError','SecurityError']) {
   const previous=await raw(target),activeName=await target.locator('#char-name').inputValue();
   await target.evaluate(errorName=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===STORE_KEY)throw new DOMException('Test failure',errorName);return originalSetItem.call(this,k,v);};},errorName);
   assert.equal(await importJSON(target,addFile),false);assert.equal(await raw(target),previous);
   assert.equal(await target.locator('#char-name').inputValue(),activeName);
   assert.match(await target.locator('#toast').textContent(),/Импорт не сохранён/);
   assert.ok(await target.locator('#storage-error').isVisible());
   assert.equal(await target.evaluate(()=>saveAll()),false);
   // Even with failed local writes, export captures the live, unsaved form.
   await target.locator('#notes-misc').evaluate(el=>el.value='Спасти несохранённое');
   const rescueEvent=target.waitForEvent('download');assert.equal(await target.evaluate(()=>exportCharacters()),true);
   const rescue=JSON.parse(await fs.readFile(await (await rescueEvent).path(),'utf8'));
   assert.equal(rescue.list.find(c=>c.id===rescue.active).data.fields['notes-misc'],'Спасти несохранённое');
   assert.equal(await raw(target),previous);
   await target.evaluate(()=>{Storage.prototype.setItem=originalSetItem;});
   assert.equal(await target.evaluate(()=>saveAll()),true);
   assert.equal(await target.locator('#storage-error').count(),0);
  }
  assert.equal(await importJSON(target,addFile),true);
  // A genuine browser quota failure (no mocked Storage API).
  const quotaBefore=await raw(target);
  assert.equal(await target.evaluate(()=>importCharacters(new File([JSON.stringify({fields:{'char-name':'Слишком большой герой','notes-misc':'x'.repeat(6*1024*1024)}})],'quota.json'))),false);
  assert.equal(await raw(target),quotaBefore);
  assert.match(await target.locator('#storage-error').textContent(),/заполнен/);
  // Concurrent file selections cannot interleave commits.
  await target.evaluate(()=>{window.waitingImport=importCharacters({size:100,text:()=>new Promise(resolve=>window.finishRead=resolve)});});
  assert.equal(await importJSON(target,addFile),false);
  await target.evaluate(()=>finishRead(JSON.stringify({fields:{'char-name':'Последовательный импорт'}})));
  assert.equal(await target.evaluate(()=>waitingImport),true);
  await target.locator('#notes-misc').evaluate(el=>el.value='Сохранено при уходе');
  await target.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  const onHide=JSON.parse(await raw(target));
  assert.equal(onHide.list.find(c=>c.id===onHide.active).data.fields['notes-misc'],'Сохранено при уходе');
  // Read errors/corrupt stores must never be silently replaced with default heroes.
  await fresh.setOffline(false);
  const isolated=await browser.newContext({serviceWorkers:'block'}),readPage=await isolated.newPage();
  await open(readPage);
  await readPage.evaluate(()=>localStorage.setItem(STORE_KEY,'{broken'));
  await readPage.reload();await readPage.locator('.welcome-btn').click();
  assert.equal(await raw(readPage),'{broken');
  assert.equal(await importJSON(readPage,json),false);assert.equal(await raw(readPage),'{broken');
  await isolated.close();
  // Failed legacy migration retains its source and displays the existing hero.
  const migration=await browser.newContext({serviceWorkers:'block'}),migrationPage=await migration.newPage();
  await migrationPage.addInitScript(()=>{
   localStorage.setItem('dnd_hero_save',JSON.stringify({charName:'Миграция',notesMisc:'Старое сохранение',state:{}}));
   const original=Storage.prototype.setItem;
   Storage.prototype.setItem=function(k,v){if(k==='dnd_store_v4')throw new DOMException('full','QuotaExceededError');return original.call(this,k,v);};
  });
  await open(migrationPage);
  assert.equal(await migrationPage.locator('#char-name').inputValue(),'Миграция');
  assert.equal(await migrationPage.evaluate(()=>localStorage.getItem('dnd_store_v4')),null);
  assert.ok(await migrationPage.evaluate(()=>localStorage.getItem('dnd_hero_save')));
  assert.ok(await migrationPage.locator('#storage-error').isVisible());
  await migration.close();
  assert.deepEqual(errors,[]);assert.equal(await target.evaluate(()=>window.injected),undefined);
  console.log('PASS: 3 complete heroes, real JSON downloads, isolated device import, all fields/photos/spells/inventory/history, offline reload and re-export, deduplication, conflicts, legacy files, malformed/checksum/type/version/size/read failures, real/mocked quota/security failures, legacy migration failure, pagehide saving, concurrent imports and rescue export.');
 } finally {await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
