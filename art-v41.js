// Original art direction. Presentation only; no character schema changes.
const ART_CLASS_ORDER=['Воин','Маг','Плут','Клерик','Паладин','Следопыт','Варвар','Бард','Монах','Чародей','Колдун','Друид'];
const ART_SCHOOLS={
  'Ограждение':['abjuration','M16 5 25 9v8c0 7-9 11-9 11S7 24 7 17V9Z M16 10v12 M11 16h10'],
  'Вызов':['conjuration','M6 23h20 M9 20a9 9 0 1 1 14 0 M12 25v3 M20 25v3 M16 4v4 M3 14h4 M25 14h4'],
  'Прорицание':['divination','M3 16s5-8 13-8 13 8 13 8-5 8-13 8S3 16 3 16 M16 3v3 M16 26v3 M5 5l3 3 M24 24l3 3'],
  'Очарование':['enchantment','M16 26S4 19 4 11c0-7 9-8 12-2 3-6 12-5 12 2 0 8-12 15-12 15 M12 13h8 M16 9v8'],
  'Воплощение':['evocation','M18 3 7 18h8l-1 11 12-17h-9Z'],
  'Иллюзия':['illusion','M3 16s5-7 13-7 13 7 13 7-5 7-13 7S3 16 3 16 M9 4c4 3 10-3 14 0 M9 28c4-3 10 3 14 0'],
  'Некромантия':['necromancy','M9 23v-4a10 10 0 1 1 14 0v4Z M12 23v5 M16 23v5 M20 23v5 M11 13h2 M19 13h2 M15 19h2'],
  'Преобразование':['transmutation','M7 11a10 10 0 0 1 18-2 M25 4v6h-6 M25 21A10 10 0 0 1 7 23 M7 28v-6h6 M16 11l5 5-5 5-5-5Z']
};
function artSchoolIcon(school,large=false) {
  const data=ART_SCHOOLS[school]||ART_SCHOOLS['Воплощение'];
  return `<span class="school-symbol ${large?'large':''} school-${data[0]}" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="${data[1]}"/>${/divination|illusion/.test(data[0])?'<circle cx="16" cy="16" r="3"/>':''}</svg></span>`;
}
function artApplyClass() {
  const banner=document.getElementById('hero-banner');
  let cover=banner.querySelector('.class-cover');
  if(!cover){cover=document.createElement('div');cover.className='class-cover';cover.setAttribute('aria-hidden','true');banner.prepend(cover);}
  const cls=document.getElementById('char-class').value;
  const index=Math.max(0,ART_CLASS_ORDER.indexOf(cls));
  cover.style.backgroundPosition=`${(index%3)*50}% ${Math.floor(index/3)*100/3}%`;
  cover.dataset.class=cls;
  banner.style.background='';
}
function artPulse(element,style='art-pulse') {
  if(!element||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  element.classList.remove(style);
  // Restart only the small feedback animation, without rebuilding the control.
  void element.offsetWidth;
  element.classList.add(style);
  element.addEventListener('animationend',()=>element.classList.remove(style),{once:true});
}
function artItemKind(item) {
  const n=item.name.toLocaleLowerCase('ru');
  if(/меч|клинок|рапира|фальшион|эсток|сабля|пал[ао]ш/.test(n))return 0;
  if(/доспех|броня|латы|кольчуг|кираса/.test(n))return 1;
  if(/зелье|эликсир|противоядие/.test(n))return 2;
  if(/свиток/.test(n))return 3;
  if(/кольцо|перстень/.test(n))return 4;
  if(/посох/.test(n))return 5;
  if(/рюкзак|сумка|набор|спальник/.test(n))return 6;
  if(/книга|гримуар/.test(n))return 7;
  return -1;
}
function artRarity(item) {
  const raw=uiItemEntry(item).rarity||item.rarity;
  if(!raw)return null;
  const s=String(raw).toLocaleLowerCase('ru');
  let key='common';
  if(/артефакт|artifact/.test(s))key='artifact';
  else if(/легендар|legendary/.test(s))key='legendary';
  else if(/очень ред|very rare/.test(s))key='very-rare';
  else if(/необыч|uncommon/.test(s))key='uncommon';
  else if(/редк|rare/.test(s))key='rare';
  return {key,label:String(raw)};
}
function artEnhanceInventory() {
  const item=uiView.inventory.selected,panel=document.getElementById('inventory-detail');
  if(!item||!panel)return;
  [...panel.classList].filter(c=>c.startsWith('rarity-')).forEach(c=>panel.classList.remove(c));
  const heading=panel.querySelector('h2');
  const kind=artItemKind(item),rarity=artRarity(item);
  if(kind>=0)heading.insertAdjacentHTML('afterend',`<div class="item-illustration" style="--art-x:${(kind%4)*100/3}%;--art-y:${kind>=4?100:0}%" aria-hidden="true"></div>`);
  else heading.insertAdjacentHTML('afterend',`<div class="item-engraving" aria-hidden="true">${itemIconImg(item)}</div>`);
  if(rarity){
    heading.insertAdjacentHTML('afterend',`<span class="rarity-badge rarity-${rarity.key}">${esc(rarity.label)}</span>`);
    panel.classList.add('rarity-'+rarity.key);
  }
}
// Wrap renderers to keep the tested v40 persistence and rule calculations intact.
const artBaseClass=applyClassTheme;
applyClassTheme=function(){artBaseClass();artApplyClass();};
const artBaseSpells=renderSpellList;
renderSpellList=function(){
  artBaseSpells();
  document.querySelectorAll('#spell-list .spell-row').forEach(row=>{
    const name=row.querySelector('.spell-row-name').textContent;
    const spell=state.spells.find(s=>s.name===name);
    const d=spell?findSpellDetails(spell):{};
    const icon=row.querySelector('.spell-row-icon');
    if(icon)icon.outerHTML=artSchoolIcon(d.school||spell?.school);
  });
};
const artBaseDetail=uiSpellDetail;
uiSpellDetail=function(){
  artBaseDetail();
  const spell=uiView.spells.selected;
  if(spell){
    const d=findSpellDetails(spell);
    document.querySelector('#spell-detail .detail-eyebrow')?.insertAdjacentHTML('beforebegin',artSchoolIcon(d.school||spell.school,true));
  }
};
const artBaseInventory=renderInventory;
renderInventory=function(){
  artBaseInventory();
  document.querySelectorAll('#inv-list .inventory-row').forEach(row=>{
    const label=row.getAttribute('aria-label');
    const item=state.inventory.find(it=>it.name+': открыть'===label);
    const rarity=item&&artRarity(item);
    if(rarity)row.querySelector('.inv-name')?.insertAdjacentHTML('beforeend',`<span class="rarity-badge rarity-${rarity.key}">${esc(rarity.label)}</span>`);
  });
};
const artBaseItemDetail=uiInventoryDetail;
uiInventoryDetail=function(){artBaseItemDetail();artEnhanceInventory();};
const artBasePortrait=renderPortrait;
renderPortrait=function(){
  if(state.portrait==='gallery-halfling'&&!state.portraitImg){
    const image=document.getElementById('portrait-img');image.src='images/art/halfling.webp';image.style.display='block';
    document.getElementById('portrait-emoji').style.display='none';
  }else artBasePortrait();
};
const artBasePicker=openPortraitPicker;
openPortraitPicker=function(){
  artBasePicker();
  document.getElementById('emoji-grid').insertAdjacentHTML('afterbegin',`<button class="portrait-gallery-choice ${state.portrait==='gallery-halfling'&&!state.portraitImg?'picked':''}" title="Портрет полурослика" aria-label="Портрет полурослика" onclick="pickPortraitEmoji('gallery-halfling')"><img src="images/art/halfling.webp" alt=""></button>`);
};
const artBaseSlots=toggleSlot;
toggleSlot=function(si,di){artBaseSlots(si,di);artPulse(document.querySelectorAll('#spell-slots-grid .spell-slot-card')[state.spellSlots.filter((s,i)=>i<si&&s.total).length]);};
const artBaseHP=updateHPDisplay;
let artPreviousHP=null;
updateHPDisplay=function(){
  artBaseHP();
  const value=state.hp.current;
  if(artPreviousHP!==null&&artPreviousHP!==value)artPulse(document.querySelector('.hp-section'),value>artPreviousHP?'art-heal':'art-damage');
  artPreviousHP=value;
  artRefreshOverview();
};
// Existing critical-roll feedback remains the single source of roll results.
const artBaseFeedback=rollFeedback;
rollFeedback=function(crit,fail){artBaseFeedback(crit,fail);if(crit)artPulse(document.querySelector('#screen-main .nav-bar'),'art-critical');};
const artBaseApply=applyCharacter;
applyCharacter=function(data){artPreviousHP=null;artBaseApply(data);};
// Portrait picker is also reachable with a keyboard.
const artPortrait=document.querySelector('.char-portrait');
artPortrait.tabIndex=0;artPortrait.setAttribute('role','button');artPortrait.setAttribute('aria-label','Выбрать портрет героя');
artPortrait.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openPortraitPicker();}});
artApplyClass();
// Compact play overview, using the existing state and existing action handlers.
const artOverview=document.createElement('section');artOverview.className='hero-overview';
artOverview.setAttribute('aria-label','Краткий обзор героя');
document.getElementById('hero-banner').after(artOverview);
function artRefreshOverview() {
  const panel=document.querySelector('.hero-overview');if(!panel)return;
  const hp=state.hp||{current:0,max:0};
  const percent=Math.max(0,Math.min(100,hp.current/Math.max(1,hp.max)*100));
  const slots=(state.spellSlots||[]).reduce((s,x)=>({total:s.total+x.total,left:s.left+x.total-x.used}),{total:0,left:0});
  const cls=document.getElementById('char-class').value;
  const ac=document.getElementById('stat-ac').value;
  const speed=document.getElementById('stat-speed').value;
  const initiative=document.getElementById('stat-init').textContent;
  panel.innerHTML=`<div class="overview-health"><div class="overview-title"><h2>Здоровье</h2><span><b>${hp.current}</b> / ${hp.max}</span></div><div class="overview-track"><i style="width:${percent}%"></i></div><div class="overview-actions">${uiButton('Урон',"showHPModal('damage')",'danger')}${uiButton('Лечение',"showHPModal('heal')")}</div></div><div class="overview-stats"><div><b>${esc(ac)}</b><span>Броня</span></div><div><b>${esc(initiative)}</b><span>Инициатива</span></div><div><b>${esc(speed)}</b><span>Скорость, фут</span></div></div>${slots.total?`<button type="button" class="overview-magic" onclick="activateTab('spells')"><span class="overview-orb" aria-hidden="true">✧</span><span><strong>${cls==='Колдун'?'Магия договора':'Ячейки заклинаний'}</strong><small>${slots.left} / ${slots.total} доступно</small></span><span aria-hidden="true">›</span></button>`:''}`;
}
const artBaseRenderSlots=renderSpellSlots;
renderSpellSlots=function(){artBaseRenderSlots();artRefreshOverview();};
const artBaseInitiative=updateInitiative;
updateInitiative=function(){artBaseInitiative();artRefreshOverview();};
document.addEventListener('change',e=>{if(['stat-ac','stat-speed','char-class','char-level'].includes(e.target.id))artRefreshOverview();});
document.getElementById('hero-edit').insertAdjacentHTML('afterend','<button type="button" class="ui-button hero-edit portrait-link" aria-label="Выбрать портрет" onclick="openPortraitPicker()">Портрет</button>');
artRefreshOverview();
