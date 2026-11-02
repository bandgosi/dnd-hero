// iOS layout regression: usable width, safe areas, welcome CTA and live resizing.
// Run with Playwright installed: node tests/ios-layout.cjs
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const server=spawn('python3',['-m','http.server','8004'],{cwd:root,stdio:'ignore'});
 let browser;
 try {
  await new Promise(r=>setTimeout(r,350));
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-gpu']});
  const page=await browser.newPage({hasTouch:true,serviceWorkers:'block'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let insets={top:0,right:0,bottom:0,left:0};
  // Chromium headless does not expose iOS cutouts. Substitute only CSS env()
  // values in the real app sources; all layout and navigation code runs unchanged.
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!=='http://localhost:8004'||!(url.pathname==='/'||/\.(html|css)$/.test(url.pathname)))return route.continue();
   const file=path.join(root,url.pathname==='/'?'index.html':url.pathname.slice(1));
   const body=fs.readFileSync(file,'utf8').replace(/env\(safe-area-inset-(top|right|bottom|left)(?:,\s*0px)?\)/g,(_,side)=>insets[side]+'px');
   await route.fulfill({body,contentType:file.endsWith('.css')?'text/css':'text/html'});
  });
  const cases=[
   [320,568,0,0,0,0],[393,852,59,0,34,0],[430,932,59,0,34,0],
   [600,700,0,0,0,0],[720,900,0,0,0,0],[721,900,0,0,0,0],[722,900,0,0,0,0],
   [800,900,24,0,20,0],[824,636,0,80,20,44],[852,393,0,44,21,44],
   [932,430,0,59,21,59],[1024,768,24,0,20,0],[1536,1081,0,0,0,0]
  ];
  for(const [width,height,top,right,bottom,left]of cases){
   insets={top,right,bottom,left};
   await page.setViewportSize({width,height});await page.goto('http://localhost:8004');
   const label=`${width}×${height} safe ${JSON.stringify(insets)}`;
   assert.equal(await page.locator('meta[name="apple-mobile-web-app-status-bar-style"]').getAttribute('content'),'black-translucent');
   const welcome=await page.evaluate(()=>{
    const screen=document.querySelector('#screen-welcome'),bg=document.querySelector('.welcome-bg');
    return {scroll:screen.scrollHeight,height:screen.clientHeight,width:bg.clientWidth,scrollWidth:bg.scrollWidth,bg:getComputedStyle(document.documentElement).backgroundColor};
   });
   assert.equal(welcome.bg,'rgb(12, 15, 19)');
   assert.ok(welcome.scrollWidth<=welcome.width+1,`${label}: welcome must not overflow horizontally`);
   const button=await page.locator('.welcome-btn').boundingBox();
   assert.ok(button.x>=left&&button.x+button.width<=width-right,`${label}: CTA must respect side safe areas`);
   assert.ok(button.y>=top&&button.y+button.height<=height-bottom,`${label}: CTA must be visible before scrolling`);
   await page.locator('.welcome-btn').click();
   const input=await page.locator('#char-name').elementHandle();
   await page.evaluate(()=>{document.getElementById('char-name').value='Герой iOS';saveAll();});
   for(const tab of ['character','spells','dice','inventory','notes','guide']){
    await page.evaluate(tab=>activateTab(tab),tab);
    const overflow=await page.evaluate(()=>[...document.querySelectorAll('.content,.tab-content,.section')].filter(e=>e.getBoundingClientRect().height&&e.scrollWidth>e.clientWidth+2).map(e=>e.id||e.className));
    assert.deepEqual(overflow,[],`${label}: ${tab} content overflow`);
   }
   await page.evaluate(()=>{activateTab('spells');uiOpen('spells',0);});
   const narrow=await page.locator('#tab-spells .ui-master').evaluate(e=>getComputedStyle(e).display==='none');
   assert.equal(narrow,width-(width>=720?2:0)-left-right<720,`${label}: master/detail follows usable shell width`);
   const detail=await page.locator('#spell-detail').boundingBox();
   assert.ok(detail.x>=left&&detail.x+detail.width<=width-right+1,`${label}: spell detail respects safe areas`);
   // Resizing must preserve form elements, the selected spell and character data.
   const selected=await page.evaluate(()=>uiView.spells.selected.name);
   await page.setViewportSize({width:393,height:852});
   assert.equal(await input.evaluate(e=>e===document.querySelector('#char-name')),true);
   assert.equal(await page.locator('#char-name').inputValue(),'Герой iOS');
   assert.equal(await page.evaluate(()=>uiView.spells.selected.name),selected);
   await page.evaluate(()=>uiBack('spells'));
   assert.ok(await page.locator('#tab-spells .ui-master').isVisible());
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: 13 iOS/foldable/desktop viewports, safe-area CTA/detail bounds, all tabs, container breakpoint and live resize persistence. Chromium emulation; on-device Safari verification remains manual.');
 } finally {await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exit(1);});
