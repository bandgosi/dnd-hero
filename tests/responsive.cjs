// Run after installing Playwright and Chromium: node tests/responsive.cjs
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
const server=require('child_process').spawn('python3',['-m','http.server','8000'],{cwd:path.resolve(__dirname,'..'),stdio:'ignore'});
process.on('exit',()=>server.kill());
await new Promise(r=>setTimeout(r,300));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE || undefined,args:['--no-sandbox','--disable-gpu','--no-zygote']});
const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:8000');await page.locator('.welcome-btn').click();
await page.evaluate(()=>{localStorage.setItem('fx_sound','0');document.querySelector('#char-name').value='Проверка Fold';saveAll();});
const results=[];
for(const [w,h] of [[320,780],[360,800],[390,844],[430,932],[719,900],[720,900],[800,900],[900,800],[1100,700],[1440,900],[800,360]]){
 await page.setViewportSize({width:w,height:h});
 for(const tab of ['character','spells','dice','inventory','notes','guide']){
 await page.evaluate(tab=>activateTab(tab),tab);
 const variants=tab==='character'?['main','combat','abilities']:[''];
 for(const sub of variants){
 if(sub) await page.evaluate(sub=>switchSubtab('char',sub,document.querySelectorAll('#tab-character .subtab-btn')[['main','combat','abilities'].indexOf(sub)]),sub);
 await page.waitForTimeout(40);
 const data=await page.evaluate(()=>{
 const visible=e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height;
 return [...document.querySelectorAll('.content,.tab-content,.section,.modal-sheet')].filter(visible).filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>({id:e.id,cls:e.className,width:e.clientWidth,scroll:e.scrollWidth}));
 });
 if(data.length)results.push({w,h,tab,sub,overflow:data});

 }
 }
}
await page.setViewportSize({width:800,height:900});await page.evaluate(()=>{activateTab('character');switchSubtab('char','combat',document.querySelectorAll('#tab-character .subtab-btn')[1]);});
const before=await page.evaluate(()=>state.hp);await page.locator('#hp-minus').click();
await page.setViewportSize({width:360,height:800});
const stateCheck=await page.evaluate(()=>({name:document.querySelector('#char-name').value,hp:state.hp}));
assert.equal(stateCheck.name,'Проверка Fold');
assert.equal(stateCheck.hp.current,before.current-1);
for(const width of [320,390,720,800,1440]) {
 await page.setViewportSize({width,height:800});
 await page.evaluate(()=>showHPModal('damage'));
 const bounds=await page.locator('.modal-overlay.open .modal-sheet').boundingBox();
 assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+1);
 assert.ok(bounds.y>=0 && bounds.y+bounds.height<=801);
 await page.evaluate(()=>document.querySelectorAll('.modal-overlay').forEach(e=>e.classList.remove('open')));
}
await page.evaluate(()=>{activateTab('notes');document.querySelector('#notes-campaign').value='Текст до раскрытия';saveAll();});
await page.setViewportSize({width:360,height:800});
await page.reload();await page.locator('.welcome-btn').click();
assert.equal(await page.locator('#notes-campaign').inputValue(),'Текст до раскрытия');
assert.equal(await page.locator('#char-name').inputValue(),'Проверка Fold');
assert.equal(await page.evaluate(()=>state.hp.current),before.current-1);
await page.evaluate(()=>{activateTab('dice');rollDice(20);});
await page.waitForFunction(()=>/\d/.test(document.querySelector('#dice-result').textContent));
assert.deepEqual(results,[], 'Content must not overflow horizontally');
assert.deepEqual(errors,[], 'No browser JavaScript errors');
console.log('PASS: 11 viewports × all tabs, modal bounds, resize/reload persistence, dice, no JS errors.');
await browser.close();server.kill();
})().catch(error=>{console.error(error);process.exit(1);});
