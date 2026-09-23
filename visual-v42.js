// v42: presentation and explicit equipment markers; existing rule handlers remain authoritative.
const V42_ICONS={
 swords:'M4 3l13 13m-4 1 4-4m0 3 4 5M20 3 7 16m-3-3 6 6m-3-3-4 5',
 shield:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z',
 heart:'M12 20S3 14 3 8c0-5 6-6 9-2 3-4 9-3 9 2 0 6-9 12-9 12Z',
 die:'M12 2 3 7v10l9 5 9-5V7ZM3 7l9 3 9-3M12 10v12',
 book:'M12 6C9 3 5 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-7-1-10 2Zm0 0v15',
 pack:'M7 7V5a5 5 0 0 1 10 0v2M6 7h12l2 14H4ZM8 12h8v5H8Z',
 target:'M12 2v4m0 12v4M2 12h4m12 0h4M5 5a10 10 0 0 1 14 14A10 10 0 0 1 5 5ZM9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
 eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm7 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
 moon:'M19 16A9 9 0 0 1 8 3a9 9 0 1 0 11 13Z',
 skull:'M7 18v-3a8 8 0 1 1 10 0v3ZM9 18v4m6-4v4M8 10h1m6 0h1',
 star:'m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',
 bolt:'M14 2 5 14h6l-1 8 9-13h-6Z',
 hat:'M5 17 12 2l7 15M2 20h20M7 13h10',
 bulb:'M8 16a7 7 0 1 1 8 0v3H8Zm1 6h6',
 scroll:'M6 3h13v16H8a3 3 0 0 1 0-6h11M6 3a3 3 0 0 0 0 6h3V3M11 7h5m-5 3h5',
};
function v42Icon(name){return `<svg class="ui-ic line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${V42_ICONS[name]||V42_ICONS.star}"/></svg>`;}
const v42OldIcon=uiIc;
uiIc=function(name){return V42_ICONS[name]?v42Icon(name):v42OldIcon(name);};
function v42ReplaceIcons(root){
 const nodes=[...(root.querySelectorAll?.('img.ui-ic')||[])];if(root.matches?.('img.ui-ic'))nodes.push(root);
 nodes.forEach(img=>{const name=img.getAttribute('src')?.match(/images\/ui\/(.+)\.png$/)?.[1];if(V42_ICONS[name])img.outerHTML=v42Icon(name);});
}
v42ReplaceIcons(document);
new MutationObserver(records=>records.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1)v42ReplaceIcons(n);}))).observe(document.body,{childList:true,subtree:true});
function v42Battle(){activateTab('character');const btn=document.querySelector('[onclick*="switchSubtab(\'char\',\'combat\'"]');switchSubtab('char','combat',btn);document.getElementById('char-content').scrollTop=0;}
const v42Overview=artRefreshOverview;
artRefreshOverview=function(){v42Overview();document.querySelector('.hero-overview').insertAdjacentHTML('beforeend',`<button class="ui-button primary battle-entry" onclick="v42Battle()">${v42Icon('swords')} Боевой экран <span>Атаки · ячейки · состояния</span></button>`);};
const v42Ability=renderAbilities;
renderAbilities=function(){v42Ability();document.querySelectorAll('.ability-card').forEach((card,i)=>{const old=card.querySelector('.ability-mod');const btn=document.createElement('button');btn.className=old.className;btn.textContent=old.textContent;btn.setAttribute('aria-label',`Проверка: ${ABILITY_FULL[i]}, ${old.textContent}`);btn.onclick=()=>rollCheck('Проверка: '+ABILITY_FULL[i],mod(state.abilities[i]));old.replaceWith(btn);card.querySelector('input').setAttribute('aria-label','Значение: '+ABILITY_FULL[i]);});};
const slots=document.createElement('section');slots.className='section battle-slots';slots.innerHTML='<h2 class="section-title">Ячейки в бою</h2><div id="battle-slots"></div>';
document.querySelector('.combat-actions').children[1].before(slots);
const conditionSection=document.querySelector('.conditions-wrap').closest('.section');
document.querySelector('.combat-vitals').append(conditionSection);
const bookkeeping=document.createElement('details');bookkeeping.className='ui-details battle-bookkeeping';bookkeeping.innerHTML='<summary>Временные HP и спасброски от смерти</summary>';
const tempSection=document.getElementById('temp-hp').closest('.section');tempSection.before(bookkeeping);bookkeeping.append(tempSection,document.querySelector('.death-saves').closest('.section'));
const conditionsDetails=document.createElement('details');conditionsDetails.className='ui-details';conditionsDetails.innerHTML='<summary>Изменить состояния</summary>';conditionSection.before(conditionsDetails);conditionsDetails.append(conditionSection);
const v42HP=updateHPDisplay;updateHPDisplay=function(){v42HP();if(state.hp.current<=0)bookkeeping.open=true;};
const activeStates=document.createElement('div');activeStates.id='battle-conditions';activeStates.setAttribute('aria-label','Активные состояния');document.querySelector('.hp-section').after(activeStates);
function v42RefreshCombat(){
 const el=document.getElementById('battle-slots');if(!el)return;
 el.innerHTML=state.spellSlots.map((s,i)=>s.total?`<div class="battle-slot-row"><span>${s.level} ур.<small>${s.total-s.used} / ${s.total}</small></span><div class="slot-dots">${Array.from({length:s.total},(_,j)=>`<button class="slot-dot ${j<s.total-s.used?'available':'used'}" onclick="toggleSlot(${i},${j})" aria-label="Боевая ячейка ${s.level} уровня" aria-pressed="${j>=s.total-s.used}"></button>`).join('')}</div></div>`:'').join('')||'<p class="ui-muted">У этого героя нет ячеек.</p>';
 document.getElementById('battle-conditions').innerHTML=state.conditions.length?state.conditions.map((c,i)=>`<button class="condition-chip active" onclick="v42Condition(${i})">${v42Icon(c==='Концентрация'?'target':'shield')}${esc(c)}</button>`).join(''):'<span class="ui-muted">Нет активных состояний</span>';
 document.querySelectorAll('.condition-chip[data-cond]').forEach(b=>b.setAttribute('aria-pressed',String(state.conditions.includes(b.dataset.cond))));
}
const conditionDialog=document.createElement('dialog');conditionDialog.className='v42-dialog';document.body.append(conditionDialog);
function v42Condition(i){
 const name=state.conditions[i];if(!name)return;
 // Reuse the local reference text; no new rules or automatic effects.
 const entry=QA_DB.find(x=>x.id==='combat-conditions');
 const doc=document.createElement('div');doc.innerHTML=entry.a;
 const line=entry.a.split('<br>').map(x=>{doc.innerHTML=x;return doc.textContent;}).find(x=>x.startsWith(name+' '));
 conditionDialog.innerHTML=`<h2>${esc(name)}</h2><p>${esc(line|| (name==='Концентрация'?(state.concentrationSpell||'Активна концентрация на заклинании.'):'Отметка активна на листе персонажа.'))}</p><button class="ui-button" onclick="this.closest('dialog').close()">Закрыть</button>`;conditionDialog.showModal();
}
for(const name of ['renderAll','renderSpellSlots','updateConcentrationChip']){const base=window[name];window[name]=function(...args){const r=base.apply(this,args);v42RefreshCombat();return r;};}
const v42Inv=renderInventory;
renderInventory=function(){v42Inv();const list=document.getElementById('inv-list');const rows=[...list.querySelectorAll('.inventory-row')];rows.forEach(row=>{const i=Number(row.getAttribute('onclick').match(/,(\d+)/)?.[1]);const item=state.inventory[i];row.classList.toggle('equipped',!!item?.equipped);if(item?.equipped)row.querySelector('.inv-name').insertAdjacentHTML('beforeend','<small class="equipment-label">Экипировано</small>');});rows.sort((a,b)=>Number(b.classList.contains('equipped'))-Number(a.classList.contains('equipped'))).forEach(row=>list.append(row));};
const v42Detail=uiInventoryDetail;
uiInventoryDetail=function(){v42Detail();const it=uiView.inventory.selected;if(!it)return;const i=state.inventory.indexOf(it);if(['weapon','armor'].includes(uiItemCategory(it)))document.querySelector('#inventory-detail .quantity-control').insertAdjacentHTML('beforebegin',`<button class="ui-button equip-button" aria-pressed="${!!it.equipped}" onclick="v42Equip(${i})">${v42Icon('shield')}${it.equipped?'Снять с героя':'Экипировать'}</button><p class="ui-muted">Отметка снаряжения. КД и бонусы задаются в листе героя.</p>`);};
function v42Equip(i){const it=state.inventory[i];if(!it)return;it.equipped=!it.equipped;renderInventory();saveAll();}
const receipt=document.createElement('aside');receipt.className='roll-receipt';receipt.hidden=true;receipt.setAttribute('role','status');receipt.setAttribute('aria-live','polite');document.body.append(receipt);let receiptTimer;
const v42History=addRollHistory;
addRollHistory=function(label,total,rolls,bonus,sides){v42History(label,total,rolls,bonus,sides);const critical=sides===20&&rolls.length===1&&rolls[0]===20,fail=sides===20&&rolls.length===1&&rolls[0]===1;receipt.className='roll-receipt'+(critical?' natural-twenty':fail?' natural-one':'');receipt.innerHTML=`<button class="receipt-close" aria-label="Закрыть результат" onclick="this.parentElement.hidden=true">×</button><span>${esc(label)}</span><strong>${esc(String(total))}</strong><small>${rolls.length===1?`${rolls[0]} ${bonus<0?'−':'+'} ${Math.abs(bonus||0)} = ${total}`:`Кубики: ${rolls.join(', ')} · модификатор ${bonus||0}`}${critical?' · Натуральная 20':fail?' · Натуральная 1':''}</small>`;receipt.hidden=false;clearTimeout(receiptTimer);receiptTimer=setTimeout(()=>receipt.hidden=true,5500);};
const v42Apply=applyCharacter;
applyCharacter=function(...args){receipt.hidden=true;return v42Apply.apply(this,args);};
document.querySelector('.combat-actions').append(bookkeeping,conditionsDetails);
const attackSection=document.getElementById('attacks-list').closest('.section');slots.before(attackSection);
artRefreshOverview();v42RefreshCombat();
