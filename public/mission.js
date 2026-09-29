// Контроллер миссии: хранение и DOM. Правила BFS — только в mission-core.js.
import {MISSION_VERSION,MISSIONS,createMission,applyMissionAction,restoreMission} from './mission-core.js';
import {missionText as m} from './mission-i18n.js';
import {adjacency} from './core.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fresh=()=>({version:MISSION_VERSION,screen:'brief',guided:[],transfer:[],paths:{guided:[],transfer:[]},reflectionChoice:null,reflectionErrors:0,reflectionPassed:false,note:''});
export function restoreMissionRecord(raw){
  if(raw===null||raw===undefined)return fresh();
  if(!raw||raw.version!==MISSION_VERSION||!['brief','guided','transfer','reflection','finish'].includes(raw.screen))throw Error('Invalid mission record');
  const guided=restoreMission('guided',raw.guided),transfer=restoreMission('transfer',raw.transfer);
  if(transfer.actions.length&&guided.phase!=='done')throw Error('Transfer before guided completion');
  const paths={};
  for(const stage of ['guided','transfer']){
    const path=raw.paths?.[stage]??[],ids=MISSIONS[stage].graph.nodes.map(n=>n.id);
    if(!Array.isArray(path)||path.length>24||path.some(id=>!ids.includes(id)))throw Error('Invalid path draft');
    paths[stage]=[...path];
  }
  const choice=raw.reflectionChoice;
  if(choice!==null&&![0,1,2].includes(choice))throw Error('Invalid reflection');
  if(!Number.isInteger(raw.reflectionErrors)||raw.reflectionErrors<0||raw.reflectionErrors>100000)throw Error('Invalid reflection count');
  const passed=raw.reflectionPassed===true&&choice===1&&transfer.phase==='done';
  const screen=raw.screen==='finish'&&!passed?'reflection':raw.screen;
  if(['transfer','reflection','finish'].includes(screen)&&guided.phase!=='done'||['reflection','finish'].includes(screen)&&transfer.phase!=='done')throw Error('Invalid mission stage');
  return {version:MISSION_VERSION,screen,guided:guided.actions,transfer:transfer.actions,paths,reflectionChoice:choice,reflectionErrors:raw.reflectionErrors,reflectionPassed:passed,note:typeof raw.note==='string'?raw.note.slice(0,1200):''};
}
export function missionReport(record){
  const clean=restoreMissionRecord(record);
  return {format:'graph-bfs-mission',version:MISSION_VERSION,storage:'local-browser',assessment:'practice-not-school-grade',completed:clean.reflectionPassed,
    stages:['guided','transfer'].map(stage=>{const s=restoreMission(stage,clean[stage]);return {stage,start:MISSIONS[stage].start,target:MISSIONS[stage].target,completed:s.phase==='done',errors:s.errors,hints:s.hints,path:s.path,actions:s.actions};}),
    reflection:{choice:clean.reflectionChoice,errors:clean.reflectionErrors,passed:clean.reflectionPassed,note:clean.note}};
}
export function missionCard(){return `<section class="mission-course-card"><span class="mission-card-symbol" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 12 36 14 26 36 12 12M12 12 12 32 26 36"/><circle cx="12" cy="12" r="4"/><circle cx="36" cy="14" r="4"/><circle cx="26" cy="36" r="4"/><circle cx="12" cy="32" r="3"/></svg></span><div><p class="eyebrow">${esc(m('eyebrow'))} · ${esc(m('experimental'))}</p><h2>${esc(m('cardTitle'))}</h2><p>${esc(m('cardText'))}</p></div><a class="button-link primary" href="#/mission">${esc(m('begin'))} →</a></section>`;}

export function mountMission(root,{storage,storageKey}){
  let record,notice='',saveFailed=false,retryConfirm=false,reflectionFeedback='',lastError=false;
  try{record=restoreMissionRecord(storage.get(storageKey,null));}catch{record=fresh();notice=m('invalidSave');}
  let states={guided:restoreMission('guided',record.guided),transfer:restoreMission('transfer',record.transfer)};
  const controller=new AbortController();
  root.innerHTML='<div id="mission-body"></div><p id="mission-announcement" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>';
  const body=root.querySelector('#mission-body'),announcement=root.querySelector('#mission-announcement');
  const save=()=>{saveFailed=!storage.set(storageKey,record);};
  const isStage=()=>record.screen==='guided'||record.screen==='transfer';
  function go(screen){record.screen=screen;lastError=false;reflectionFeedback='';retryConfirm=false;save();render();root.querySelector('#mission-heading')?.focus({preventScroll:true});root.scrollIntoView({block:'start'});}
  function status(s,id){return s.phase==='done'&&s.path.includes(id)?'route':s.current===id?'current':s.processed.includes(id)?'processed':s.discovered.includes(id)?'queued':'unopened';}
  function graph(s,interactive=true){
    const {graph,start,target}=MISSIONS[s.stage],positions=Object.fromEntries(graph.nodes.map(n=>[n.id,n]));
    const chosen=s.phase==='done'?s.path:record.paths[s.stage];
    const edgePath=new Set(chosen.slice(1).map((n,i)=>[chosen[i],n].sort((a,b)=>a-b).join('-')));
    const edges=graph.edges.map(e=>{const a=positions[e.a],b=positions[e.b];return `<line class="mission-edge ${edgePath.has([e.a,e.b].sort((a,b)=>a-b).join('-'))?'is-path':''}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;}).join('');
    const neighbors=adjacency(graph);
    const nodes=graph.nodes.map(n=>{const state=status(s,n.id),label=`${m('nodeStatus',{node:n.id,status:m(state)})}${s.levels[n.id]!==undefined?'. '+m('level',{level:s.levels[n.id]}):''}. ${m('neighbors',{nodes:neighbors[n.id].map(v=>v.id)})}`;
      return `<g class="mission-node is-${state}" id="mission-svg-${n.id}" transform="translate(${n.x} ${n.y})" ${!interactive||s.phase==='done'?'':`role="button" tabindex="0" data-mission="node" data-value="${n.id}"`} aria-label="${esc(label)}"><circle r="25"/><text class="mission-number" y="1">${n.id}</text><text class="mission-node-tag" y="-35">${n.id===start?esc(m('start')):n.id===target?esc(m('target')):''}</text><text class="mission-node-level" y="43">${s.levels[n.id]!==undefined?'ℓ = '+s.levels[n.id]:''}</text></g>`;}).join('');
    return `<svg class="mission-svg" viewBox="0 0 720 350" role="group" aria-label="${esc(m('network'))}">${edges}${nodes}</svg>`;
  }
  const chips=ids=>ids.length?ids.map(id=>`<span class="mission-chip">${id}</span>`).join('<span class="mission-chip-arrow" aria-hidden="true">→</span>'):`<span class="muted">${esc(m('empty'))}</span>`;
  function rules(){return `<details class="mission-rules"><summary>${esc(m('rule'))}</summary><ol>${['rule1','rule2','rule3'].map(k=>`<li>${esc(m(k))}</li>`).join('')}</ol><p><strong>${esc(m('sortRule'))}</strong></p><p>${esc(m('completionRule'))}</p></details>`;}
  function stageView(s){
    const {graph:missionGraph,start,target}=MISSIONS[s.stage],finished=s.phase==='done';
    const title=s.phase==='take'?m('takeTitle'):s.phase==='add'?m('addTitle',{node:s.current}):s.phase==='path'?m('pathTitle'):m('stageDone');
    const description=s.phase==='take'?m('takeText'):s.phase==='add'?m('addText'):s.phase==='path'?m('pathText'):m('routeFound',{path:s.path.join(' → '),distance:s.path.length-1});
    const f=s.feedback;
    const path=record.paths[s.stage];
    return `<div class="mission-objective"><span class="mission-stage-label">${esc(m(s.stage))}</span><h2 id="mission-heading" tabindex="-1">${esc(m('objective',{start,target}))}</h2><p>${esc(m(s.stage==='guided'?'guidedNote':'transferNote'))}</p></div>
      <div class="mission-workspace"><section class="mission-board"><div class="mission-board-header"><span>${esc(m('network'))}</span><strong>${esc(m('processedCount',{count:s.processed.length,total:missionGraph.nodes.length}))}</strong></div>${graph(s)}
      <div class="mission-legend">${['unopened','current','queued','processed','route'].map(k=>`<span><i class="is-${k}" aria-hidden="true"></i>${esc(m(k))}</span>`).join('')}</div>
      ${!finished?`<div class="mission-node-picker" role="group" aria-label="${esc(m('network'))}">${missionGraph.nodes.map(n=>`<button id="mission-node-${n.id}" data-mission="node" data-value="${n.id}" aria-label="${esc(m('choose',{node:n.id}))}" class="is-${status(s,n.id)}">${n.id}</button>`).join('')}</div>`:''}
      <details class="mission-connections"><summary>${esc(m('connections'))}</summary><ul>${Object.entries(adjacency(missionGraph)).map(([id,neighbors])=>`<li><strong>${id}</strong> — ${esc(m('neighbors',{nodes:neighbors.map(v=>v.id)}))}</li>`).join('')}</ul></details></section>
      <aside class="mission-task"><p class="eyebrow">${esc(m('loop'))}</p><h2>${esc(title)}</h2><p>${esc(description)}</p>
      <div class="mission-queue-panel"><h3>${esc(m('queue'))}</h3><p>${esc(m('queueOrder'))}</p><div class="mission-queue">${chips(s.queue)}</div></div>
      <div class="mission-feedback ${lastError?'is-error':''}" id="mission-feedback">${esc(m('feedback.'+f.code,f))}</div>
      ${s.phase==='add'?`<button class="primary mission-wide" id="mission-finish-node" data-mission="finish">${esc(m('finishNode'))}</button>`:''}
      ${s.phase==='path'?`<div class="mission-path"><h3>${esc(m('route'))}</h3><p class="mission-path-chain">${path.length?path.join(' → '):esc(m('pathEmpty'))}</p><p class="small muted">${esc(m('pathLength',{count:Math.max(0,path.length-1)}))}</p><div class="mission-actions"><button data-mission="undo" ${!path.length?'disabled':''}>${esc(m('undo'))}</button><button data-mission="clear-path" ${!path.length?'disabled':''}>${esc(m('clear'))}</button></div><button class="primary mission-wide" id="mission-check-path" data-mission="check-path" ${path.length<2?'disabled':''}>${esc(m('checkPath'))}</button></div>`:''}
      ${!finished?`<button class="mission-hint" id="mission-hint" data-mission="hint">? ${esc(m('hint'))}</button>`:`<div class="mission-earned"><h3>${esc(m('earned'))}</h3><p>✓ ${esc(m('queueBadge'))}</p><p>✓ ${esc(m('pathBadge'))}</p>${s.stage==='transfer'?`<p>✓ ${esc(m('transferBadge'))}</p>`:''}</div><button class="primary mission-wide" data-mission="next-stage">${esc(m(s.stage==='guided'?'nextNetwork':'explain'))}</button>`}
      <div class="mission-counters"><span>${esc(m('hintsCount',{count:s.hints}))}</span><span>${esc(m('errorsCount',{count:s.errors}))}</span></div>
      <details class="mission-order"><summary>${esc(m('completedOrder'))}</summary><p>${s.processed.join(' → ')||esc(m('empty'))}</p></details></aside></div>${rules()}`;
  }
  function reflectionView(){return `<section class="mission-reflection"><p class="eyebrow">04 · ${esc(m('reflection'))}</p><h2 id="mission-heading" tabindex="-1">${esc(m('reflectionTitle'))}</h2><p>${esc(m('reflectionText'))}</p><form id="mission-reflection-form"><fieldset><legend class="sr-only">${esc(m('reflectionTitle'))}</legend>${[0,1,2].map(i=>`<label class="mission-choice"><input type="radio" name="mission-reflection" value="${i}" ${record.reflectionChoice===i?'checked':''}><span>${esc(m('choice'+i))}</span></label>`).join('')}</fieldset><label class="field" for="mission-note">${esc(m('ownWords'))}<span class="small muted">${esc(m('ownPrompt'))}</span></label><textarea id="mission-note" rows="3" maxlength="1200">${esc(record.note)}</textarea><p class="small muted">${esc(m('ownNote'))}</p><p class="mission-reflection-feedback ${reflectionFeedback?'is-error':''}">${esc(reflectionFeedback)}</p><button class="primary" type="submit">${esc(m('reflectionCheck'))}</button></form></section>`;}
  function resultsView(){return `<section class="mission-results"><div class="mission-success-icon" aria-hidden="true">✓</div><p class="eyebrow">BFS · ${esc(m('finish'))}</p><h2 id="mission-heading" tabindex="-1">${esc(m('missionDone'))}</h2><p>${esc(m('resultText'))}</p><div class="mission-result-grid">${['guided','transfer'].map(stage=>{const s=states[stage];return `<section><h3>${esc(m(stage))}</h3><span class="mission-result-badge">${esc(m(s.hints?'withHelp':'withoutHelp'))}</span><p class="mission-path-chain">${s.path.join(' → ')}</p><p>${esc(m('errorsCount',{count:s.errors}))}</p><p>${esc(m('hintsCount',{count:s.hints}))}</p></section>`;}).join('')}</div><p class="small muted">${esc(m('reflectionErrors',{count:record.reflectionErrors}))}</p>${record.note?`<details class="mission-rules"><summary>${esc(m('ownWords'))}</summary><p class="mission-own-note">${esc(record.note)}</p></details>`:''}<p class="mission-result-limit">${esc(m('resultLimit'))}</p><div class="mission-python"><div><h3>${esc(m('nextPython'))}</h3><p>${esc(m('queueBadge'))} → Python</p></div><a class="button-link primary" href="#/lesson/21">${esc(m('pythonLink'))}</a></div></section>`;}
  function render(){
    const openDetails=['mission-rules','mission-connections','mission-order'].filter(name=>body.querySelector('details.'+name)?.open);
    const active=isStage()?record.screen:record.screen==='finish'?'reflection':record.screen;
    const steps=['brief','guided','transfer','reflection'];
    body.innerHTML=`<div class="mission-intro ${isStage()?'is-active':''}"><div><p class="eyebrow">${esc(m('eyebrow'))} <span class="mission-experiment">${esc(m('experimental'))}</span></p><h1>${esc(m('title'))}</h1><p>${esc(m('intro'))}</p></div><a href="#/course">${esc(m('backCourse'))}</a></div>
      <nav class="mission-stepper" aria-label="${esc(m('stepNav'))}">${steps.map((step,i)=>{const enabled=i<2||i===2&&states.guided.phase==='done'||i===3&&states.transfer.phase==='done';const done=i===1?states.guided.phase==='done':i===2?states.transfer.phase==='done':i===3?record.reflectionPassed:record.screen!=='brief';return `<button data-mission="navigate" data-value="${step}" ${enabled?'':'disabled'} ${active===step?'aria-current="step"':''}><span>${done?'✓':String(i+1).padStart(2,'0')}</span>${esc(m(step))}</button>`;}).join('')}</nav>
      ${notice?`<p class="notice">${esc(notice)}</p>`:''}
      ${record.screen==='brief'?`<div class="mission-brief"><section><p class="eyebrow">BFS · ${esc(m('noMarks'))}</p><h2 id="mission-heading" tabindex="-1">${esc(m('briefTitle'))}</h2><p>${esc(m('briefText'))}</p><h3>${esc(m('loop'))}</h3><ol>${['rule1','rule2','rule3'].map(k=>`<li>${esc(m(k))}</li>`).join('')}</ol><p class="mission-brief-rule">${esc(m('sortRule'))}</p><p>${esc(m('whatNext'))}</p><button class="primary" data-mission="begin">${esc(m(record.guided.length?'resume':'begin'))} →</button></section><aside class="mission-brief-visual">${graph(states.guided,false)}<p>${esc(m('objective',MISSIONS.guided))}</p><p class="small muted">${esc(m('practicePromise'))}</p></aside></div>`:isStage()?stageView(states[record.screen]):record.screen==='reflection'?reflectionView():resultsView()}
      <footer class="mission-footer"><p id="mission-save-status" class="small ${saveFailed?'error-text':'muted'}">${esc(m(saveFailed?'failedSave':'saved'))}</p><p class="small muted">${esc(m('localOnly'))}</p><div class="mission-actions"><button data-mission="export">${esc(m('export'))}</button><button data-mission="retry">${esc(m('retry'))}</button></div>${retryConfirm?`<div class="mission-retry-confirm" role="group" aria-label="${esc(m('retryPrompt'))}"><p>${esc(m('retryPrompt'))}</p><button data-mission="confirm-retry">${esc(m('confirmRetry'))}</button><button data-mission="cancel-retry">${esc(m('cancel'))}</button></div>`:''}<p class="small muted">${esc(m('exportNote'))}</p></footer>`;
    for(const name of openDetails){const details=body.querySelector('details.'+name);if(details)details.open=true;}
  }
  function dispatch(action){
    const stage=record.screen,previous=states[stage],next=applyMissionAction(previous,action);
    states[stage]=next;record[stage]=next.actions;lastError=next.errors>previous.errors||next.feedback.code==='history_limit';
    save();render();announcement.textContent=m('feedback.'+next.feedback.code,next.feedback);
  }
  function act(button){
    const type=button.dataset.mission,value=button.dataset.value,focusId=button.id;
    if(type==='begin'){go(record.reflectionPassed?'finish':states.transfer.phase==='done'?'reflection':states.guided.phase==='done'?'transfer':'guided');return;}
    if(type==='navigate'){if(value==='transfer'&&states.guided.phase!=='done'||value==='reflection'&&states.transfer.phase!=='done')return;go(value==='reflection'&&record.reflectionPassed?'finish':value);return;}
    if(type==='next-stage'){go(record.screen==='guided'?'transfer':'reflection');return;}
    if(type==='retry'){retryConfirm=true;render();root.querySelector('[data-mission="confirm-retry"]')?.focus();return;}
    if(type==='cancel-retry'){retryConfirm=false;render();root.querySelector('[data-mission="retry"]')?.focus();return;}
    if(type==='confirm-retry'){record=fresh();states={guided:createMission('guided'),transfer:createMission('transfer')};notice='';go('brief');return;}
    if(type==='export'){
      const blob=new Blob([JSON.stringify(missionReport(record),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='bfs-mission-attempt.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
    }
    if(!isStage())return;
    const stage=record.screen,s=states[stage];
    if(type==='node'){
      if(s.phase==='path'){
        if(record.paths[stage].length>=24){announcement.textContent=m('pathLimit');return;}
        record.paths[stage].push(Number(value));save();render();
      }else if(s.phase!=='done')dispatch({type:s.phase==='take'?'take':'add',node:Number(value)});
    }else if(type==='finish'||type==='hint')dispatch({type});
    else if(type==='check-path')dispatch({type:'path',nodes:record.paths[stage]});
    else if(type==='undo'||type==='clear-path'){if(type==='undo')record.paths[stage].pop();else record.paths[stage]=[];save();render();}
    const repeated=focusId?root.querySelector('#'+focusId):root.querySelector(`[data-mission="${type}"]${value!==undefined?`[data-value="${value}"]`:''}`);
    const focus=repeated&&!repeated.disabled?repeated:root.querySelector('[data-mission="next-stage"]')||root.querySelector('#mission-heading');focus?.focus({preventScroll:true});
  }
  root.addEventListener('click',event=>{const button=event.target.closest('[data-mission]');if(button&&!button.disabled)act(button);},{signal:controller.signal});
  root.addEventListener('keydown',event=>{if(event.target.matches('g[data-mission]')&&['Enter',' '].includes(event.key)){event.preventDefault();act(event.target);}},{signal:controller.signal});
  root.addEventListener('change',event=>{
    if(event.target.name!=='mission-reflection'||record.screen!=='reflection')return;
    const choice=Number(event.target.value);if(![0,1,2].includes(choice))return;
    // A previously accepted explanation no longer represents the current answer.
    // Keep the completion marker and export consistent until it is checked again.
    record.reflectionChoice=choice;record.reflectionPassed=false;reflectionFeedback='';save();render();
    root.querySelector(`[name="mission-reflection"][value="${choice}"]`)?.focus({preventScroll:true});
  },{signal:controller.signal});
  root.addEventListener('input',event=>{if(event.target.id==='mission-note'){record.note=event.target.value.slice(0,1200);save();root.querySelector('#mission-save-status').textContent=m(saveFailed?'failedSave':'saved');}},{signal:controller.signal});
  root.addEventListener('submit',event=>{
    if(event.target.id!=='mission-reflection-form'||record.screen!=='reflection'||states.transfer.phase!=='done')return;event.preventDefault();event.stopPropagation();
    if(record.reflectionChoice===null)reflectionFeedback=m('reflectionChoose');
    else if(record.reflectionChoice!==1){record.reflectionErrors++;reflectionFeedback=m('reflectionWrong');}
    else{record.reflectionPassed=true;go('finish');announcement.textContent=m('missionDone');return;}
    save();render();announcement.textContent=reflectionFeedback;root.querySelector('[name="mission-reflection"]:checked')?.focus({preventScroll:true});
  },{signal:controller.signal});
  save();render();
  return {dispose(){controller.abort();}};
}
