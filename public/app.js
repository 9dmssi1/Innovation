import {t,tx,hx,hm,tRuntime,translateContent,getLocale,setLocale,translateShell} from './i18n.js';
import {GRAPH,copy,preset,trace,adjacency,key,PSEUDO,graphFromText,checkPath} from './core.js';
import {MODULES as MODULES_RU,LESSONS as LESSONS_RU,gradeQuiz,PYTHON as PYTHON_RU} from './course.js';
import {courseView,hasPassed} from './course-view.js';
import {icon} from './icons.js';
import {mountMission,missionCard,missionReport,restoreMissionRecord} from './mission.js';
import {missionText} from './mission-i18n.js';
import {Graph3D} from './graph3d.js';
import {guideHTML} from './guide.js';
import {graphFile,parseGraphFile} from './graph-file.js';
import {normalizeProgress,normalizePractice,normalizeDraft,normalizeLastLesson} from './storage-state.js';
const $=id=>document.getElementById(id);
let MODULES=translateContent(MODULES_RU),LESSONS=translateContent(LESSONS_RU),PYTHON=translateContent(PYTHON_RU);
const lessonById=id=>LESSONS.find(lesson=>lesson.id===Number(id));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const memoryStorage=new Map();
const storage={
  get(key,fallback){try{return JSON.parse(memoryStorage.has(key)?memoryStorage.get(key):localStorage.getItem(key))??fallback;}catch{return fallback;}},
  set(key,value){const json=JSON.stringify(value);try{localStorage.setItem(key,json);memoryStorage.delete(key);return true;}catch{memoryStorage.set(key,json);toast(t('Не удалось сохранить данные в браузере.'));return false;}},
  remove(key){memoryStorage.delete(key);try{localStorage.removeItem(key);return true;}catch{toast(t('Не удалось сохранить данные в браузере.'));return false;}}
};
let account={user:null,csrf:'',progress:[],classes:[],assignments:[],feedback:[],runnerOrigin:''};
let ui={lesson:null,tab:'visual',graph:preset('normal'),preset:'normal',mode:'bfs',start:1,target:9,index:0,steps:[],selected:5,predict:false,timer:null,quizResult:null,answers:[],classId:null,view:'2d'};
let spatial=null,draftTimer=null,draftContext=null;
let activeMission=null;
let currentRun=null,runnerReady=false,toastTimer=null,routeVersion=0,accountRefreshSequence=0,teacherRenderSequence=0;
const pythonFrame=$('python-frame');
const progress=()=>normalizeProgress(account.user?account.progress:storage.get('graph-guest-progress',[]),LESSONS);
const completed=id=>hasPassed(progress(),id);
const practiceKey=id=>`graph-practice-${account.user?.id||'guest'}-${id}`;
const lastLessonKey=()=>`graph-last-lesson-${account.user?.id||'guest'}`;
const missionKey=()=>`graph-mission-${account.user?.id||'guest'}-bfs-v1`;
const draftKey=id=>`graph-draft-${account.user?.id||'guest'}-${id}`;
const readPractice=lesson=>normalizePractice(storage.get(practiceKey(lesson.id),null),lesson);
const requestContext=()=>({version:routeVersion,userId:account.user?.id??null,classId:ui.classId,hash:location.hash});
const sameAccount=context=>(account.user?.id??null)===context.userId;
const currentContext=(context,classScoped=false)=>sameAccount(context)&&routeVersion===context.version&&location.hash===context.hash&&(!classScoped||ui.classId===context.classId);
function toast(message){$('toast').textContent=tRuntime(message);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
async function api(path,method='GET',data){
  const response=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':account.csrf},body:data===undefined?undefined:JSON.stringify(data)});
  const result=await response.json();if(!response.ok)throw Error(tRuntime(result.error)||t('Не удалось выполнить запрос.'));return result;
}
async function refreshAccount(expectedUserId){const sequence=++accountRefreshSequence,result=await api('/me');if(sequence!==accountRefreshSequence||expectedUserId!==undefined&&(account.user?.id??null)!==expectedUserId)return false;account=result;renderAccount();if(!pythonFrame.src){pythonFrame.src=account.runnerOrigin;}return true;}
function renderAccount(){
  document.querySelector('[data-nav="teacher"]').hidden=account.user?.role==='student';
  document.querySelector('[data-nav="assignments"]').hidden=!account.user||account.user.role==='teacher';
  $('account').innerHTML=account.user?hx`<span>${esc(account.user.name)}</span><span class="badge">${account.user.role==='teacher'?t('Учитель'):t('Ученик')}</span><button class="quiet" data-action="logout">Выйти</button>`:hm('<span class="muted small">Самостоятельный просмотр</span><button data-action="auth">Войти</button>');
}
function heading(kicker,title,text=''){return `<div class="page-intro"><div><p class="eyebrow">${esc(kicker)}</p><h1>${esc(title)}</h1>${text?`<p>${esc(text)}</p>`:''}</div></div>`;}
function renderCourse(){
  const last=normalizeLastLesson(storage.get(lastLessonKey(),account.user?null:storage.get('graph-last-lesson',null)),LESSONS);
  $('main').innerHTML=courseView({modules:MODULES,lessons:LESSONS,progress:progress(),last,user:account.user});
  $('main').querySelector('.course-aside').insertAdjacentHTML('beforeend',missionCard());
}
function filterCourse(query){
  const words=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  let count=0;
  document.querySelectorAll('[data-course-lesson]').forEach(row=>{row.hidden=!words.every(word=>row.dataset.search.includes(word));if(!row.hidden)count++;});
  document.querySelectorAll('[data-course-module]').forEach(section=>{section.hidden=![...section.querySelectorAll('[data-course-lesson]')].some(row=>!row.hidden);});
  if($('course-empty'))$('course-empty').hidden=count!==0;
}
function initLesson(id){
  if(ui.lesson?.id===id)return;
  stopPlayback();ui={...ui,lesson:lessonById(id),tab:'visual',graph:preset('normal'),preset:'normal',mode:lessonById(id).mode,start:1,target:9,index:0,selected:5,predict:false,quizResult:null,answers:readPractice(lessonById(id)).answers};rebuildSteps();storage.set(lastLessonKey(),id);
}
function rebuildSteps(){ui.index=0;const algo=['explore','compare'].includes(ui.mode)?'bfs':ui.mode;ui.steps=trace(ui.graph,algo,ui.start,ui.target);}
function renderLesson(){
  disposeSpatial();
  const l=ui.lesson;
  $('main').innerHTML=hx`<div class="lesson-heading"><div><p class="eyebrow">${esc(MODULES.find(m=>m.id===l.module).title)} <span>· ${LESSONS.indexOf(l)+1} / 15</span></p><h1>${esc(l.title)}</h1><p class="muted lesson-intro">${esc(l.intro)}</p></div><div class="lesson-tools"><span class="goal" title="Номер занятия и код учебной цели">№ ${l.id} · ${l.goal}</span><button data-action="presentation" aria-pressed="${document.body.classList.contains('presentation')}">${document.body.classList.contains('presentation')?t('Обычный вид'):t('Режим показа')}</button></div></div>
    <div class="tabs" role="tablist" aria-label="Режим занятия">${[['visual',t('Объяснение и граф')],['practice',t('Тренировка')],['python',t('Практика Python')]].map(([id,name])=>`<button role="tab" id="tab-${id}" aria-controls="lesson-content" aria-selected="${ui.tab===id}" tabindex="${ui.tab===id?0:-1}" data-action="tab" data-tab="${id}"><span class="tab-index" aria-hidden="true">${icon({visual:'basics',practice:'check',python:'code'}[id])}</span>${name}</button>`).join('')}</div><section id="lesson-content" role="tabpanel" aria-labelledby="tab-${ui.tab}"></section>
    <div class="lesson-pagination"><a href="#/course">← Все занятия</a><div>${LESSONS[LESSONS.indexOf(l)-1]?hx`<a href="#/lesson/${LESSONS[LESSONS.indexOf(l)-1].id}">← Предыдущее занятие</a>`:''}${LESSONS[LESSONS.indexOf(l)+1]?hx`<a href="#/lesson/${LESSONS[LESSONS.indexOf(l)+1].id}">Следующее занятие →</a>`:hm('<span class="muted small">Вы дошли до конца главы</span>')}</div></div>`;
  if(ui.tab==='visual')renderVisual();else if(ui.tab==='practice')renderPractice();else renderPython();
  ensureMissionEntry();
}
function settings(){const options=ui.graph.nodes.map(n=>`<option value="${n.id}"${n.id===ui.start?' selected':''}>${n.id}</option>`).join('');return hx`<div class="sim-settings"><label>Пример <select id="graph-preset"><option value="normal">Обычный</option><option value="branch">Разветвлённый</option><option value="directed">С направлениями</option><option value="disconnected">Несвязный</option>${ui.preset==='custom'?hm('<option value="custom">Свой граф</option>'):''}</select></label><label>Старт <select id="sim-start">${options}</select></label>${['path','dijkstra'].includes(ui.mode)?hx`<label>Цель <select id="sim-target">${ui.graph.nodes.map(n=>`<option value="${n.id}"${n.id===ui.target?' selected':''}>${n.id}</option>`).join('')}</select></label>`:''}${ui.lesson.id===28?hx`<label>Метод <select id="sim-method"><option value="path"${ui.mode==='path'?' selected':''}>BFS · число рёбер</option><option value="dijkstra"${ui.mode==='dijkstra'?' selected':''}>Дейкстра · сумма весов</option></select></label>`:''}<button data-action="edit-graph">Редактор графа</button></div>`;}
function renderVisual(){
  const active=document.activeElement,focusId=active?.id,focusView=active?.dataset?.action==='graph-view'?active.dataset.view:null;
  const restoreFocus=()=>{if(focusId)$(focusId)?.focus({preventScroll:true});else if(focusView)document.querySelector(`[data-action="graph-view"][data-view="${focusView}"]`)?.focus({preventScroll:true});};
  disposeSpatial();
  $('lesson-content').innerHTML=hx`${settings()}<div id="simulation"></div><p class="geometry-note">Положение вершин — только способ показать граф. Длина линии на экране не задаёт вес ребра. Поворот и перемещение не меняют результат алгоритма.</p><div class="lesson-reading"><section class="lesson-note"><h2>${icon('book')} ${t('Главная идея')}</h2><p>${esc(ui.lesson.idea)}</p></section><section class="sim-task"><h2>${icon('experiment')} ${t('Попробуйте сами')}</h2><p>${esc(ui.lesson.task)}</p><button data-action="tab" data-tab="practice">Перейти к тренировке →</button></section></div>`;
  $('graph-preset').value=ui.preset;
  if(ui.mode==='compare'){renderComparison();restoreFocus();return;}
  $('simulation').innerHTML=hx`<div class="playback-panel">${ui.mode!=='explore'?hx`<div class="graph-controls"><button data-action="back" id="sim-back">← Назад</button><button class="primary" data-action="next" id="sim-next">Шаг вперёд →</button><button data-action="play" id="sim-play">▶ Авто</button><button data-action="reset">Сброс</button></div><div class="graph-controls"><span id="sim-count" class="step-label"></span><input type="range" min="0" value="0" max="${ui.steps.length-1}" id="sim-range" aria-label="Шаг алгоритма"></div><label class="inline-check" style="margin-top:12px"><input type="checkbox" id="predict"${ui.predict?' checked':''}>Сначала предсказать следующее действие</label>`:hm('<p class="small muted" style="margin-top:12px">Нажмите вершину: справа появятся её связи и степень. Размер и положение линий не задают вес.</p>')}</div><div class="lab-layout"><div class="graph-card"><div class="graph-caption"><span>${ui.graph.directed?t('Направленный'):t('Неориентированный')} граф · вершин: ${ui.graph.nodes.length}</span><span id="sim-kind"></span></div><div id="graph-mount"></div><div class="graph-legend"><span style="--dot:#8196b0">Не открыта</span><span style="--dot:#ffd182">Текущая</span><span style="--dot:#83c0ff">Открыта</span><span style="--dot:#77dcb4">Завершена</span><span style="--dot:#caabff">Путь</span></div></div><aside id="sim-state" class="state-card" aria-live="polite"></aside></div>`;
  drawSimulation();
  ensureMissionEntry();restoreFocus();
}
function ensureMissionEntry(){if([19,20,21].includes(ui.lesson?.id)&&$('lesson-content')&&!$('lesson-content').querySelector('.mission-course-card'))$('lesson-content').insertAdjacentHTML('beforeend',missionCard());}
function disposeSpatial(){if(spatial){spatial.dispose();spatial=null;}}
function selectGraphNode(id){
  if(ui.mode==='explore'){ui.selected=id;drawSimulation();}
  else{ui.start=id;stopPlayback();rebuildSteps();if($('sim-start'))$('sim-start').value=id;drawSimulation();}
}
function mountGraphView(){
  const mount=$('graph-mount');if(!mount)return;
  if(!$('view-switch')){
    mount.insertAdjacentHTML('beforebegin',hx`<div class="view-toolbar" id="view-switch"><div class="segmented" role="group" aria-label="Отображение графа"><button data-action="graph-view" data-view="2d" aria-pressed="${ui.view==='2d'}">2D · схема</button><button data-action="graph-view" data-view="3d" aria-pressed="${ui.view==='3d'}">3D · пространство</button></div><span class="view-label">${ui.view==='3d'?t('Поверните и исследуйте связи'):t('Один граф — разные способы увидеть')}</span></div>`);
    if(ui.view==='3d')mount.insertAdjacentHTML('afterend',hx`<div class="spatial-controls"><label>Мышь <select id="spatial-mode"><option value="rotate">Поворот</option><option value="move">Перемещение вершин</option></select></label><div class="row"><button data-action="spatial-minus" aria-label="Отдалить граф">−</button><button data-action="spatial-plus" aria-label="Приблизить граф">+</button><button data-action="spatial-camera">Вернуть камеру</button><button data-action="spatial-layout">Вернуть вершины</button></div></div><p class="spatial-hint">Тяните мышью для поворота, колесо — масштаб. В режиме перемещения тяните вершину. С клавиатуры: стрелки, +/−, Home.</p>`);
  }
  if(ui.view==='3d'){
    if(!spatial)spatial=new Graph3D(mount,ui.graph,selectGraphNode);
    spatial.update(ui.steps[ui.index],ui.mode,ui.start,ui.target,ui.selected);
  }else{const focusedNode=mount.contains(document.activeElement)?document.activeElement?.dataset?.node:null;mount.innerHTML=svgGraph(ui.graph,ui.steps[ui.index],ui.mode,ui.selected);if(focusedNode)mount.querySelector(`[data-node="${focusedNode}"]`)?.focus({preventScroll:true});}
}
function svgGraph(graph,step,mode='bfs',selected=null){
  const weighted=mode==='dijkstra'||mode==='explore',positions=Object.fromEntries(graph.nodes.map(n=>[n.id,n]));
  const paths=step.path?.slice(1).map((id,i)=>key(step.path[i],id,graph.directed))||[];
  const edges=graph.edges.map(e=>{const a=positions[e.a],b=positions[e.b],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),k=key(e.a,e.b,graph.directed),cls=paths.includes(k)?'path':step.active?.includes(k)?'active':'';return `<line class="edge ${cls}" x1="${a.x+dx/len*26}" y1="${a.y+dy/len*26}" x2="${b.x-dx/len*31}" y2="${b.y-dy/len*31}"${graph.directed?' marker-end="url(#arrow)"':''}/>${weighted?`<circle class="weight-bg" cx="${(a.x+b.x)/2}" cy="${(a.y+b.y)/2}" r="14"/><text class="weight" x="${(a.x+b.x)/2}" y="${(a.y+b.y)/2}">${e.w}</text>`:''}`;}).join('');
  const nodes=graph.nodes.map(n=>{const cls=mode==='explore'?(selected===n.id?'selected':''):step.path?.includes(n.id)?'path':step.current===n.id?'current':step.done?.includes(n.id)?'done':step.frontier?.includes(n.id)||step.stack?.includes(n.id)?'frontier':'';const label=mode==='explore'?'':`${mode==='dfs'?t('гл.'):mode==='dijkstra'?'d':'ℓ'}=${step.dist?.[n.id]??'∞'}`;return hx`<g class="node ${cls}" data-node="${n.id}" role="button" tabindex="0" aria-label="Вершина ${n.id}${step.current===n.id?t(', текущая'):''}. ${mode==='explore'?t('Показать связи'):t('Выбрать старт')}" transform="translate(${n.x} ${n.y})"><circle class="disc" r="26"/><text class="number">${n.id}</text><text class="node-meta" x="42" y="28">${esc(label)}</text><text class="tag" x="0" y="-41">${mode!=='explore'&&n.id===ui.start?t('СТАРТ'):mode!=='explore'&&['path','dijkstra'].includes(mode)&&n.id===ui.target?t('ЦЕЛЬ'):''}</text></g>`;}).join('');
  return hx`<svg class="graph-svg" viewBox="0 0 720 350" role="group" aria-label="Интерактивный граф"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L6,3 z" fill="#a9bdd8"/></marker></defs>${edges}${nodes}</svg>`;
}
function tokens(ids,cls=''){return ids.length?`<div class="tokens">${ids.map(id=>`<span class="token ${cls}">${id}</span>`).join('')}</div>`:hm('<p class="small muted">Пока пусто</p>');}
function nextQuestion(){const step=ui.steps[ui.index+1];if(!step)return null;
  if(['visit','select','enter'].includes(step.kind))return {text:t('Какую вершину будем обрабатывать следующей?'),answer:step.current,options:ui.graph.nodes.map(n=>n.id)};
  if(step.kind==='descend')return {text:t('К какому соседу уйдём в рекурсивный вызов?'),answer:step.next,options:ui.graph.nodes.map(n=>n.id)};
  if(step.kind==='relax'){const c=step.change;return {text:tx`После проверки ${c.from} → ${c.to} какое расстояние оставим у ${c.to}?`,answer:c.after,options:[...new Set([c.before,c.candidate,null])]};}return null;
}
function drawSimulation(){
  if(!$('graph-mount'))return;
  const step=ui.steps[ui.index];mountGraphView();
  if(ui.mode==='explore'){
    const id=ui.selected,neighbors=adjacency(ui.graph)[id]||[],incoming=ui.graph.edges.filter(e=>e.b===id).map(e=>e.a);
    $('sim-kind').textContent=t('Исследование');$('sim-state').innerHTML=hx`<p class="eyebrow">ВЫБРАННАЯ ВЕРШИНА</p><h2>Вершина ${id}</h2><p>${ui.graph.directed?t('Исходящие связи'):t('Соседи')}</p>${tokens(neighbors.map(n=>n.id))}<hr>${ui.graph.directed?hx`<p>Исходящая степень: <strong>${neighbors.length}</strong></p><p>Входящая степень: <strong>${incoming.length}</strong></p>`:hx`<p>Степень вершины: <strong>${neighbors.length}</strong></p>`}<hr><p>${ui.graph.directed?t('Стрелка задаёт разрешённое направление. Обратный переход возможен только при наличии обратной дуги.'):t('По каждому ребру можно двигаться в обе стороны. Число рядом с ребром — его вес.')}</p>`;return;
  }
  const question=ui.predict?nextQuestion():null;
  const prediction=ui.predict?hx`<div class="prediction"><h3>Сначала ваша версия</h3><p>${esc(question?.text||t('Следующий шаг завершает действие. Продолжите просмотр.'))}</p>${question?`<div class="choice-row">${question.options.map(v=>`<button data-action="predict-answer" data-value="${v===null?'null':v}">${v??'∞'}</button>`).join('')}</div><p id="prediction-feedback" role="status" class="small" style="margin-top:8px"></p>`:''}</div>`:'';
  const stateBlock=ui.mode==='dfs'?hx`<h3>Стек вызовов · последний справа</h3>${tokens(step.stack,'call')}<p class="small muted" style="margin-top:8px">Глубина ${step.stack.length}. При возврате последний вызов снимается.</p>`:['path','dijkstra'].includes(ui.mode)?hx`<h3>${ui.mode==='path'?t('Уровни и предшественники'):t('Расстояния и предшественники')}</h3><table class="state-table"><thead><tr><th>Вершина</th><th>${ui.mode==='path'?'ℓ':'d'}</th><th>Через</th></tr></thead><tbody>${ui.graph.nodes.map(n=>`<tr class="${step.current===n.id?'current':''}"><td>${n.id}</td><td>${step.dist[n.id]??'∞'}</td><td>${step.parent[n.id]??'—'}</td></tr>`).join('')}</tbody></table>`:hx`<h3>Очередь · первая слева</h3>${tokens(step.frontier)}`;
  $('sim-state').innerHTML=hx`${prediction}<p class="eyebrow">ШАГ ${ui.index} ИЗ ${ui.steps.length-1}</p><h2>${esc(tRuntime(step.title))}</h2><p>${esc(tRuntime(step.text))}</p><hr>${stateBlock}<hr><h3>Порядок открытия / обработки</h3>${tokens(step.order,'finished')}<details style="margin-top:15px"><summary>Связь с Python</summary><ol class="code-lines">${(PSEUDO[ui.mode]||PSEUDO.bfs).map((line,i)=>`<li class="${step.code.includes(i+1)?'active':''}">${esc(tRuntime(line))}</li>`).join('')}</ol></details>`;
  $('sim-kind').textContent=ui.mode==='dfs'?'DFS':ui.mode==='dijkstra'?t('Дейкстра'):ui.mode==='path'?t('Путь через BFS'):'BFS';
  $('sim-count').textContent=tx`Шаг ${ui.index} / ${ui.steps.length-1}`;$('sim-range').value=ui.index;
  $('sim-back').disabled=ui.index===0;$('sim-next').disabled=ui.index===ui.steps.length-1;
  $('sim-play').disabled=ui.predict||ui.index===ui.steps.length-1;$('sim-play').textContent=ui.timer?t('Ⅱ Пауза'):t('▶ Авто');
}
function stopPlayback(){if(ui.timer)clearInterval(ui.timer);ui.timer=null;}
function moveTo(i,timed=false){if(!timed)stopPlayback();ui.index=Math.max(0,Math.min(ui.steps.length-1,i));if(ui.index===ui.steps.length-1)stopPlayback();drawSimulation();}
function renderComparison(){
  const results=['bfs','dfs'].map(a=>({a,s:trace(ui.graph,a,ui.start,ui.target).at(-1)}));
  $('simulation').innerHTML=hx`<div class="comparison">${results.map(({a,s})=>hx`<section class="paper"><p class="eyebrow">${a.toUpperCase()}</p><h2>${a==='bfs'?t('Сначала ближайшие уровни'):t('Сначала выбранная ветка')}</h2><div class="graph-card" style="margin-top:15px">${svgGraph(ui.graph,s,a)}</div><p class="small muted" style="margin-top:14px">Порядок открытия</p>${tokens(s.order,'finished')}<div class="metrics"><div><strong class="big">${s.checks}</strong><p>проверок соседей</p></div><div><strong class="big">${s.peak}</strong><p>максимум ${a==='bfs'?t('в очереди'):t('в стеке вызовов')}</p></div></div></section>`).join('')}</div><p class="notice">Оба алгоритма работают с одним графом и стартом. Здесь показаны проверки соседей и размер рабочей очереди / стека, а не вся память программы. DFS не гарантирует кратчайший путь.</p>`;
}
function openDialog(html){$('dialog-content').innerHTML=html;$('dialog').showModal();setTimeout(()=>$('dialog').querySelector('input,select,textarea,button:not(.dialog-close)')?.focus(),0);}
function authDialog(register=false){
  openDialog(hx`<h2>${register?t('Создать аккаунт'):t('Войти в лабораторию')}</h2><p class="dialog-subtitle">Учётная запись сохраняется на этом локальном сервере. Для тестирования используйте вымышленные имена.</p><form id="auth-form" data-register="${register}"><label class="field">Логин<input name="username" required minlength="3" maxlength="40" autocomplete="username" placeholder="Например, student01"></label>${register?hm('<label class="field">Как к вам обращаться<input name="name" maxlength="60" placeholder="Имя или псевдоним"></label><label class="field">Роль для тестирования<select name="role"><option value="student">Ученик</option><option value="teacher">Учитель</option></select></label>'):''}<label class="field">Пароль · не менее 10 символов<input name="password" type="password" required minlength="10" maxlength="128" autocomplete="${register?'new-password':'current-password'}"></label><p class="error-text" id="auth-error" role="alert"></p><button class="primary" type="submit">${register?t('Создать и войти'):t('Войти')}</button><button class="quiet" type="button" data-action="auth-switch" data-register="${!register}">${register?t('Уже есть аккаунт'):t('Создать аккаунт')}</button></form><p class="small muted" style="margin-top:20px">Обработку данных описали в разделе «Профиль и данные». Роль учителя выбирается свободно только в этой локальной версии.</p>`);
}
function graphDialog(){openDialog(hx`<h2>Свой учебный граф</h2><p class="dialog-subtitle">Каждая строка — одно ребро: начало, конец и необязательный вес. Например, 1 2 3 означает ребро между 1 и 2 с весом 3.</p><form id="graph-form"><label class="field">Количество вершин (2–12)<input type="number" name="count" min="2" max="12" value="${ui.graph.nodes.length}" required></label><label class="inline-check"><input type="checkbox" name="directed"${ui.graph.directed?' checked':''}>Направленный граф</label><label class="field">Рёбра<textarea name="edges" rows="8" spellcheck="false">${ui.graph.edges.map(e=>`${e.a} ${e.b} ${e.w}`).join('\n')}</textarea></label><div class="graph-file-actions"><p class="small muted">Передайте пример другому человеку или сохраните его для следующего урока.</p><div class="form-actions"><button type="button" data-action="export-graph">Скачать применённый граф</button><button type="button" data-action="import-graph">Открыть JSON-файл</button><input type="file" id="graph-file" accept=".json,application/json" hidden></div></div><p id="graph-error" class="error-text" role="alert"></p><div class="form-actions"><button class="primary" type="submit">Применить граф</button><button type="button" data-action="save-graph">Сохранить текущий в браузере</button><button type="button" data-action="load-graph">Открыть сохранённый</button></div></form>`);}
async function route(){
  if(activeMission){activeMission.dispose();activeMission=null;}
  stopPlayback();disposeSpatial();if(currentRun)cancelPython();saveVisibleDraft();const version=++routeVersion,parts=location.hash.replace(/^#\/?/,'').split('/'),page=parts[0]||'course';
  if(page!=='lesson')document.body.classList.remove('presentation');
  document.querySelectorAll('[data-nav]').forEach(a=>{const active=a.dataset.nav===(page==='lesson'?'course':page);a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  $('breadcrumb').textContent=page==='lesson'?t('Карта курса / Занятие'):({course:t('Учебный курс'),assignments:t('Мои задания'),teacher:t('Кабинет учителя'),profile:t('Профиль и данные'),about:t('О лаборатории')}[page]||t('Курс'));
  if(page==='lesson'&&lessonById(parts[1])){initLesson(Number(parts[1]));renderLesson();}
  else if(page==='mission'){activeMission=mountMission($('main'),{storage,storageKey:missionKey()});$('breadcrumb').textContent=t('Практика / Миссия BFS');}
  else if(page==='start'){$('main').innerHTML=guideHTML();$('breadcrumb').textContent=t('Помощь / С чего начать');}else if(page==='assignments')renderAssignments();else if(page==='teacher')await renderTeacher(version);else if(page==='profile'){renderProfile();$('main').insertAdjacentHTML('beforeend','<p class="notice" style="margin-top:20px">'+esc(missionText('localOnly'))+'</p>');}else if(page==='about')renderAbout();else renderCourse();
  if(version!==routeVersion)return version;
  $('main').dataset.page=page;
  document.title=page==='lesson'&&ui.lesson?tx`${ui.lesson.title} — Граф`:t('Граф — учебная лаборатория');
  return version;
}
function saveVisibleDraft(force=false){
  clearTimeout(draftTimer);
  if(!$('python-code')||!ui.lesson)return true;
  const key=draftKey(ui.lesson.id),code=$('python-code').value,note=$('work-note')?.value||'';
  if(!force&&draftContext?.key===key&&draftContext.code===code&&draftContext.note===note)return true;
  const saved=storage.set(key,{code,note,updated:Date.now()});
  if(saved)draftContext={key,code,note};
  return saved;
}

document.addEventListener('click',async event=>{
  if(event.target.closest('.skip')){event.preventDefault();$('main').focus();$('main').scrollIntoView({block:'start'});return;}
  const node=event.target.closest('[data-node]');
  if(node&&ui.lesson&&ui.tab==='visual'){selectGraphNode(Number(node.dataset.node));if(ui.mode==='compare')renderComparison();return;}
  const button=event.target.closest('[data-action]');if(!button)return;
  const action=button.dataset.action;
  try{
    if(action==='auth')authDialog();
    else if(action==='auth-switch')authDialog(button.dataset.register==='true');
    else if(action==='logout'){await api('/logout','POST',{});saveVisibleDraft();await refreshAccount();ui.lesson=null;await route();toast(t('Вы вышли из аккаунта.'));}
    else if(action==='tab'){stopPlayback();if(currentRun)cancelPython();saveVisibleDraft();ui.tab=button.dataset.tab;renderLesson();$('tab-'+ui.tab)?.focus();}
    else if(action==='presentation'){const active=document.body.classList.toggle('presentation');button.textContent=active?t('Обычный вид'):t('Режим показа');button.setAttribute('aria-pressed',String(active));window.scrollTo(0,0);}
    else if(action==='next')moveTo(ui.index+1);
    else if(action==='back')moveTo(ui.index-1);
    else if(action==='reset')moveTo(0);
    else if(action==='play'){if(ui.timer){stopPlayback();drawSimulation();}else{ui.timer=setInterval(()=>moveTo(ui.index+1,true),3000);drawSimulation();}}
    else if(action==='predict-answer'){const q=nextQuestion(),value=button.dataset.value==='null'?null:Number(button.dataset.value);if(q){$('prediction-feedback').textContent=value===q.answer?t('Верно. Теперь покажите следующий шаг.'):t('Пока нет. Проверьте очередь, стек или расстояния.');$('prediction-feedback').style.color=value===q.answer?'var(--teal)':'var(--red)';}}
    else if(action==='edit-graph')graphDialog();
    else if(action==='export-graph'){download('uchebny-graf.json',graphFile(ui.graph));toast(t('Скачан текущий применённый граф.'));}
    else if(action==='import-graph')$('graph-file').click();
    else if(action==='graph-view'){ui.view=button.dataset.view;renderVisual();}
    else if(action==='spatial-minus')spatial?.zoom(-0.12);
    else if(action==='spatial-plus')spatial?.zoom(0.12);
    else if(action==='spatial-camera')spatial?.reset();
    else if(action==='spatial-layout')spatial?.reset(true);
    else if(action==='save-graph'){if(storage.set('graph-custom',ui.graph))toast(t('Текущий применённый граф сохранён в браузере.'));}
    else if(action==='load-graph'){const g=storage.get('graph-custom',null);if(!g)throw Error(t('Сначала сохраните граф.'));trace(g,'bfs',g.nodes[0].id,g.nodes.at(-1).id);ui.graph=g;ui.preset='custom';ui.start=g.nodes[0].id;ui.target=g.nodes.at(-1).id;ui.selected=ui.start;rebuildSteps();$('dialog').close();renderVisual();}
    else await featureAction(action,button);
  }catch(e){toast(e.message);}
});
document.addEventListener('change',event=>{
  const el=event.target;
  if(el.name?.match(/^q\d+$/)&&el.closest('#quiz-form')){ui.answers[Number(el.name.slice(1))]=Number(el.value);storage.set(practiceKey(ui.lesson.id),{...readPractice(ui.lesson),answers:ui.answers});}
  if(el.id==='language-select'){changeLanguage(el.value).catch(e=>toast(e.message));return;}
  if(el.id==='graph-preset'){stopPlayback();ui.preset=el.value;ui.graph=preset(el.value);ui.start=1;ui.target=9;ui.selected=5;rebuildSteps();renderVisual();}
  if(el.id==='sim-start'||el.id==='sim-target'){stopPlayback();ui[el.id==='sim-start'?'start':'target']=Number(el.value);rebuildSteps();renderVisual();}
  if(el.id==='sim-method'){stopPlayback();ui.mode=el.value;rebuildSteps();renderVisual();}
  if(el.id==='predict'){stopPlayback();ui.predict=el.checked;drawSimulation();}
  if(el.id==='spatial-mode')spatial?.setInteraction(el.value);
  if(el.id==='graph-file')importGraphFile(el.files?.[0]);
  if(el.id==='class-select'){ui.classId=Number(el.value);renderTeacher(routeVersion).catch(e=>toast(e.message));}
});
async function changeLanguage(language){
  const context=requestContext();
  saveVisibleDraft();stopPlayback();const wasRunning=Boolean(currentRun);if(wasRunning)cancelPython();
  const fields=[...$('main').querySelectorAll('input,textarea,select')].filter(el=>el.type!=='file').map(el=>({id:el.id,name:el.name,type:el.type,value:el.value,checked:el.checked}));
  const scroll=window.scrollY;
  setLocale(language);translateShell();
  MODULES=translateContent(MODULES_RU);LESSONS=translateContent(LESSONS_RU);PYTHON=translateContent(PYTHON_RU);
  if(ui.lesson)ui.lesson=lessonById(ui.lesson.id);
  renderAccount();const version=await route();
  if(version!==routeVersion||!sameAccount(context)||location.hash!==context.hash)return;
  for(const field of fields){
    const candidates=field.id?[$(field.id)]:[...$('main').querySelectorAll(`[name="${CSS.escape(field.name)}"]`)];
    const el=candidates.find(el=>el&&el.type===field.type&&(!['radio','checkbox'].includes(field.type)||el.value===field.value));
    if(!el)continue;
    if(['radio','checkbox'].includes(field.type))el.checked=field.checked;else el.value=field.value;
  }
  if($('course-search'))filterCourse($('course-search').value);
  if($('spatial-mode'))spatial?.setInteraction($('spatial-mode').value);
  $('language-select').focus({preventScroll:true});window.scrollTo(0,scroll);
  if(wasRunning)toast(t('Язык изменён. Выполнение Python остановлено; код сохранён.'));
}
async function importGraphFile(file){
  if(!file)return;
  const context=requestContext(),form=$('graph-form');
  try{
    if(file.size>32768)throw Error(t('Файл графа должен быть меньше 32 КБ.'));
    const graph=parseGraphFile(await file.text());
    if(!currentContext(context)||$('graph-form')!==form||!form?.isConnected||ui.tab!=='visual')return;
    stopPlayback();ui.graph=graph;ui.preset='custom';ui.start=graph.nodes[0].id;ui.target=graph.nodes.at(-1).id;ui.selected=ui.start;
    rebuildSteps();$('dialog').close();renderVisual();toast(t('Граф открыт из файла.'));
  }catch(e){if($('graph-error'))$('graph-error').textContent=tRuntime(e.message);else toast(e.message);}
  finally{if($('graph-file'))$('graph-file').value='';}
}
document.addEventListener('focusin',event=>{if(event.target.id==='python-code')delete event.target.dataset.leaveEditor;});
document.addEventListener('input',event=>{if(event.target.id==='course-search')filterCourse(event.target.value);if(event.target.name==='path')storage.set(practiceKey(ui.lesson.id),{...readPractice(ui.lesson),path:event.target.value});if(event.target.id==='sim-range')moveTo(Number(event.target.value));if(['python-code','work-note'].includes(event.target.id)){clearTimeout(draftTimer);draftTimer=setTimeout(saveVisibleDraft,400);}if(event.target.id==='python-code')invalidatePythonResult();});
document.addEventListener('keydown',event=>{
  if(event.target.matches('[role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
    event.preventDefault();const tabs=[...document.querySelectorAll('[role="tab"]')],index=tabs.indexOf(event.target);
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();return;
  }
  if(event.target.id==='python-code'&&event.key==='Escape'){event.target.dataset.leaveEditor='true';return;}
if(event.key==='Escape'&&document.body.classList.contains('presentation')){document.body.classList.remove('presentation');const b=document.querySelector('[data-action="presentation"]');if(b){b.textContent=t('Режим показа');b.setAttribute('aria-pressed','false');}}if(event.target.closest('[data-node]')&&['Enter',' '].includes(event.key)){event.preventDefault();event.target.closest('[data-node]').dispatchEvent(new MouseEvent('click',{bubbles:true}));}if(event.target.id==='python-code'&&event.key==='Tab'&&!event.shiftKey&&event.target.dataset.leaveEditor!=='true'){const el=event.target;if(el.readOnly||currentRun)return;event.preventDefault();const a=el.selectionStart,b=el.selectionEnd;el.setRangeText('    ',a,b,'end');invalidatePythonResult();saveVisibleDraft();}});
document.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.target,data=Object.fromEntries(new FormData(form));
  if(form.id==='auth-form'){const btn=form.querySelector('[type=submit]');btn.disabled=true;try{await api(form.dataset.register==='true'?'/register':'/login','POST',data);saveVisibleDraft();await refreshAccount();ui.lesson=null;$('dialog').close();await route();toast(t('Вы вошли в аккаунт.'));}catch(e){if($('auth-error'))$('auth-error').textContent=tRuntime(e.message);else toast(e.message);}finally{btn.disabled=false;}}
  else if(form.id==='graph-form'){try{const graph=graphFromText(Number(data.count),data.edges,Boolean(data.directed));ui.graph=graph;ui.preset='custom';ui.start=graph.nodes[0].id;ui.target=graph.nodes.at(-1).id;ui.selected=ui.start;stopPlayback();rebuildSteps();$('dialog').close();renderVisual();}catch(e){$('graph-error').textContent=tRuntime(e.message);}}
  else {const button=form.querySelector('[type=submit]');if(button)button.disabled=true;try{await featureSubmit(form,data);}catch(e){const err=form.querySelector('.error-text');if(err)err.textContent=tRuntime(e.message);else toast(e.message);}finally{if(button)button.disabled=false;}}
});
$('close-dialog').onclick=()=>$('dialog').close();
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopPlayback();if(ui.tab==='visual')drawSimulation();}});
window.addEventListener('hashchange',async()=>{try{const version=await route();if(version!==routeVersion)return;window.scrollTo(0,0);$('main').focus({preventScroll:true});}catch(e){toast(e.message);}});
window.addEventListener('beforeunload',()=>saveVisibleDraft());
// Дополнительные экраны и Python находятся ниже; используют те же модель и API.
translateShell();
try{await refreshAccount();await route();}catch(e){$('main').innerHTML=hx`<div class="notice error">${esc(tRuntime(e.message))}. Запустите START.cmd и откройте адрес http://127.0.0.1:4318.</div>`;}

function renderPractice(){
  const l=ui.lesson;
  $('lesson-content').innerHTML=hx`<div class="practice-layout"><div class="paper"><h2>Проверим понимание</h2><p class="muted small" style="margin:8px 0 18px">Вопросы о графе относятся к исходному примеру из девяти вершин. Можно вернуться к разбору перед ответом.</p><form id="quiz-form">${l.questions.map((q,i)=>`<fieldset class="question" style="border:0;border-bottom:1px solid var(--border);margin:0;padding-left:0;padding-right:0"><legend><h3>${i+1}. ${esc(q.prompt)}</h3></legend>${q.options.map((o,j)=>`<label class="answer"><input type="radio" name="q${i}" value="${j}" required${ui.answers[i]===j?' checked':''}>${esc(o)}</label>`).join('')}</fieldset>`).join('')}<div class="form-actions"><button class="primary" type="submit">Проверить ответы</button><span class="small muted">Можно повторить попытку</span></div><p class="error-text" role="alert"></p></form><div id="quiz-result" aria-live="polite">${quizResultHtml()}</div></div><aside class="paper"><p class="eyebrow">ПРАКТИЧЕСКОЕ ДЕЙСТВИЕ</p><h2>${['path','dijkstra'].includes(l.mode)?t('Постройте маршрут'):t('Объясните следующий шаг')}</h2><p style="margin-top:12px;font-size:14px">${esc(l.task)}</p>${['path','dijkstra'].includes(l.mode)?hx`<form id="path-form"><label class="field">Маршрут от 1 до 8<input name="path" value="${esc(readPractice(l).path)}" placeholder="1 4 5 8" required></label><button type="submit">Проверить путь</button><p class="small" id="path-feedback" role="status" style="margin-top:12px"></p></form>`:hm('<button style="margin-top:18px" data-action="start-prediction">Перейти к предсказанию</button>')}<hr style="border:0;border-top:1px solid var(--border);margin:20px 0"><p class="small muted">Это тренировка. Правильный ответ сопровождается объяснением. Итоговую оценку за практическую работу выставляет учитель.</p></aside></div>`;
}
function quizResultHtml(){const r=ui.quizResult;if(!r)return '';return hx`<div class="notice ${r.score===r.total?'success':'warning'}"><strong>${r.score} из ${r.total} верно.</strong> ${r.score===r.total?t('Проверка занятия выполнена.'):t('Разберите объяснения и попробуйте ещё раз.')}</div>${r.items.map((item,i)=>hx`<p class="result-item ${item.correct?'':'wrong'}"><strong>${item.correct?'✓':'○'} Вопрос ${i+1}.</strong> ${esc(t(item.explanation))}</p>`).join('')}`;}
function invalidatePythonResult(){if(currentRun)cancelPython();if($('python-output'))$('python-output').textContent='';if($('python-status'))$('python-status').textContent=t('Код изменён. Запустите проверки для нового решения.');}
function pythonKind(){return ui.lesson.module==='dfs'?'dfs':ui.lesson.module==='path'||ui.lesson.id===32?'path':'bfs';}
function renderPython(){
  const l=ui.lesson;
  if(l.module==='basics'){$('lesson-content').innerHTML=hx`<div class="paper prose"><h2>Как записать граф в Python</h2><p>Словарь связывает номер вершины со списком соседей. Запись <code>1: [2, 4]</code> означает: из 1 можно перейти в 2 и 4.</p><pre class="run-output">graph = {\n    1: [2, 4],\n    2: [1, 3, 5],\n    3: [2, 6],\n    4: [1, 5, 7],\n    5: [2, 4, 6, 8],\n    6: [3, 5, 9],\n    7: [4, 8],\n    8: [5, 7, 9],\n    9: [6, 8]\n}</pre><p>Для неориентированного графа каждое ребро записано с обеих сторон. Для направленного графа в список включаем только исходящие переходы.</p><p>В занятии 21 вы напишете и запустите BFS на таком словаре.</p><a href="#/lesson/21">Перейти к программированию BFS →</a></div>`;return;}
  const kind=pythonKind(),task=PYTHON[kind],draft=normalizeDraft(storage.get(draftKey(l.id),null),task.starter);
  draftContext={key:draftKey(l.id),code:draft.code,note:draft.note};
  $('lesson-content').innerHTML=hx`<div class="notice">Реализуйте <strong>${task.signature}</strong>. ${esc(task.description)} Интернет нужен только для загрузки среды Python; код выполняется на вашем компьютере.</div><div class="python-layout"><div><div class="editor-shell"><div class="editor-head"><span>solution.py</span><span>Python · ${task.name}</span></div><label class="sr-only" for="python-code">Код решения на Python</label><textarea aria-describedby="editor-keys" id="python-code" class="editor" spellcheck="false" autocapitalize="off" autocomplete="off">${esc(draft.code)}</textarea></div><p id="editor-keys" class="small muted editor-keys">Tab — отступ. Shift+Tab или Escape, затем Tab — выход из редактора.</p><div class="form-actions"><button class="primary" id="run-python" data-action="run-python">▶ Запустить проверки</button><button id="stop-python" data-action="stop-python" disabled>Остановить</button><button data-action="reference">Показать пример</button><button data-action="reset-code">Начать заново</button></div><label class="field" for="work-note">Объясните своё решение<textarea id="work-note" class="notes" maxlength="2000" placeholder="Почему выбрали этот алгоритм? Какие случаи проверили?">${esc(draft.note)}</textarea></label><button data-action="save-work">${account.user?t('Сохранить работу для учителя'):t('Сохранить в этом браузере')}</button><p class="small muted" style="margin-top:9px">Черновик сохраняется автоматически в браузере. Для отправки работы в класс нужна учётная запись.</p></div><section class="paper"><p class="eyebrow">САМОПРОВЕРКА</p><h2>Результат выполнения</h2><p class="small muted" style="margin-top:9px">Проверим обычный граф, цикл и граничные случаи. Для пути принимается любой кратчайший маршрут.</p><div id="python-status" class="notice">Напишите решение или откройте пример, затем запустите проверки.</div><pre id="python-output" class="run-output" aria-live="polite"></pre><p class="small muted" style="margin-top:16px">Эта самопроверка помогает найти ошибки. Она не заменяет проверку решения учителем.</p><div id="teacher-comment"></div></section></div>`;
  const feedback=account.feedback.filter(f=>f.lesson_id===l.id);
  if(feedback.length)$('teacher-comment').innerHTML=feedback.map(f=>hx`<div class="notice"><strong>Комментарий учителя · ${esc(f.class_name)}</strong><p>${esc(f.comment)}</p></div>`).join('');
  if(currentRun){$('run-python').disabled=true;$('stop-python').disabled=false;$('python-status').textContent=t('Выполняется предыдущая проверка…');}
  if(account.user){
    const userId=account.user.id,lessonId=l.id,initialCode=draft.code,initialNote=draft.note,version=routeVersion,editor=$('python-code');
    api('/submission?lesson='+lessonId).then(saved=>{
      if(!saved||currentRun||version!==routeVersion||account.user?.id!==userId||ui.lesson?.id!==lessonId||$('python-code')!==editor)return;
      if($('python-code').value!==initialCode||$('work-note').value!==initialNote)return;
      if(draft.updated&&draft.updated>=Date.parse(saved.updated))return;
      $('python-code').value=saved.code;$('work-note').value=saved.note;
      draftContext={key:draftKey(lessonId),code:saved.code,note:saved.note};
      if(saved.report){$('python-output').textContent=saved.report;$('python-status').textContent=t('Загружена сохранённая работа и её предыдущая самопроверка.');}
    }).catch(()=>{});
  }
}
function requireAccountScreen(title,text){$('main').innerHTML=heading(t('ЛИЧНЫЙ КАБИНЕТ'),title)+hx`<div class="empty"><h2>Войдите в аккаунт</h2><p>${esc(text)}</p><button class="primary" data-action="auth">Войти или зарегистрироваться</button></div>`;}
function renderAssignments(){
  if(!account.user){requireAccountScreen(t('Мои задания'),t('После входа вы сможете присоединиться к классу, получать задания и отправлять код учителю.'));return;}
  if(account.user.role==='teacher'){$('main').innerHTML=heading(t('ЗАДАНИЯ'),t('Вы вошли как учитель'),t('Назначайте занятия и проверяйте работы в кабинете учителя.'))+hm('<a href="#/teacher">Открыть кабинет учителя →</a>');return;}
  $('main').innerHTML=heading(t('РАБОТА С КЛАССОМ'),t('Мои задания'),t('Уроки, назначенные вашим учителем, и обратная связь по работам.'))+hx`<div class="paper" style="margin-bottom:23px"><form id="join-form" class="row"><label for="invite">Присоединиться к классу</label><input id="invite" name="invite" placeholder="Код от учителя" maxlength="20" required><button type="submit">Присоединиться</button><p class="error-text" role="alert"></p></form>${account.classes.length?hx`<p class="small muted" style="margin-top:10px">Ваши классы: ${account.classes.map(c=>esc(c.name)).join(', ')}</p>`:''}</div>${account.assignments.length?account.assignments.map(a=>{const l=lessonById(a.lesson_id);return hx`<article class="assignment"><div><span class="badge ${completed(l.id)?'pass':''}">${completed(l.id)?t('Проверка пройдена'):t('Назначено')} · ${esc(a.class_name)}</span><h3 style="margin-top:9px">${l.id}. ${esc(l.title)}</h3><p>Разберите пример, выполните тренировку и сохраните Python-работу.</p></div><a href="#/lesson/${l.id}">Открыть занятие →</a></article>`;}).join(''):hm('<div class="empty"><h2>Заданий пока нет</h2><p>Присоединитесь к классу по коду. Пока можно самостоятельно выбрать занятие в карте курса.</p><a href="#/course">Карта курса →</a></div>')}${account.feedback.length?hx`<h2 style="margin:25px 0 12px">Комментарии учителя</h2>${account.feedback.map(f=>hx`<div class="notice"><strong>Занятие ${f.lesson_id} · ${esc(f.class_name)}</strong><p>${esc(f.comment)}</p></div>`).join('')}` :''}`;
}
async function renderTeacher(version){
  if(version!==routeVersion||location.hash.replace(/^#\/?/,'').split('/')[0]!=='teacher')return;
  const renderId=++teacherRenderSequence,userId=account.user?.id??null;
  if(!account.user){requireAccountScreen(t('Кабинет учителя'),t('Создайте аккаунт с ролью учителя, затем класс и первое назначение. Для проверки можно открыть ученика в отдельном профиле браузера.'));return;}
  if(account.user.role!=='teacher'){$('main').innerHTML=heading(t('КАБИНЕТ УЧИТЕЛЯ'),t('Этот раздел доступен учителю'),t('Ваши задания и комментарии находятся в разделе «Мои задания».'))+hm('<a href="#/assignments">Мои задания →</a>');return;}
  const classes=account.classes;
  if(!classes.some(c=>c.id===ui.classId))ui.classId=classes[0]?.id||null;
  $('main').innerHTML=heading(t('УЧЕБНЫЙ ПРОЦЕСС'),t('Кабинет учителя'),t('Создайте класс, назначьте занятие и посмотрите, где ученикам нужна помощь.'))+hx`<div class="paper"><form id="class-form" class="row"><label for="class-name">Новый класс</label><input id="class-name" name="name" maxlength="60" placeholder="Например, 11 А · тест" required><button type="submit">Создать класс</button><p class="error-text" role="alert"></p></form></div><div id="class-results" style="margin-top:22px">${classes.length?hm('<p class="muted">Загружаем результаты…</p>'):hm('<div class="empty"><h2>Начните с первого класса</h2><p>После создания появится код приглашения. Ученики вводят его в разделе «Мои задания».</p></div>')}</div>`;
  if(!ui.classId)return;
  const requestedClass=ui.classId;const result=await api('/results?class='+requestedClass);
  if(version!==routeVersion||renderId!==teacherRenderSequence||(account.user?.id??null)!==userId||ui.classId!==requestedClass||!$('class-results'))return;
  $('class-results').innerHTML=hx`<div class="paper"><div class="row" style="justify-content:space-between"><label class="row">Класс<select id="class-select" class="teacher-selector">${classes.map(c=>`<option value="${c.id}"${c.id===ui.classId?' selected':''}>${esc(c.name)}</option>`).join('')}</select></label><div class="row"><span class="small muted">Код приглашения</span><strong style="letter-spacing:1px">${esc(result.class.invite)}</strong><button data-action="copy-invite" data-invite="${esc(result.class.invite)}">Копировать</button></div></div><form id="assign-form" class="row" style="margin-top:19px"><label for="assign-lesson">Назначить занятие</label><select id="assign-lesson" name="lessonId">${LESSONS.map(l=>`<option value="${l.id}">${l.id}. ${esc(l.title)}</option>`).join('')}</select><button class="primary" type="submit">Назначить классу</button><p class="error-text" role="alert"></p></form><p class="small muted" style="margin-top:12px">Назначено: ${result.assignments.length?result.assignments.map(a=>a.lesson_id).join(', '):t('пока ни одного занятия')}</p></div><section class="paper" style="margin-top:20px"><div class="row" style="justify-content:space-between"><h2>Работы учеников · ${result.students.length}</h2><button data-action="refresh-teacher">Обновить</button></div>${result.students.length?hx`<div class="table-wrap"><table class="results-table"><thead><tr><th>Ученик</th><th>Проверки понимания</th><th>Сохранённые работы Python</th></tr></thead><tbody>${result.students.map(s=>`<tr><td><strong>${esc(s.name)}</strong><br><span class="small muted">${esc(s.username)}</span></td><td>${s.progress.length?s.progress.map(p=>hx`<div>Урок ${p.lesson_id}: ${p.score}/${p.total} · ${p.attempts} попыт.</div>`).join(''):t('Пока нет попыток')}</td><td>${s.submissions.length?s.submissions.map(work=>hx`<button style="margin:3px" data-action="review-work" data-student="${s.id}" data-lesson="${work.lesson_id}">Урок ${work.lesson_id} · открыть</button>`).join(''):t('Работы ещё не отправлены')}</td></tr>`).join('')}</tbody></table></div>`:hm('<p class="muted" style="margin-top:16px">В классе пока нет учеников. Зарегистрируйте тестового ученика в другом профиле браузера и введите код приглашения.</p>')}<p class="notice">Результаты Python — самопроверка ученика. Откройте код, прочитайте обоснование и оставьте свой комментарий. Проверки понимания оцениваются сервером.</p></section>`;
  ui.classResults=result;
}
function renderProfile(){
  if(!account.user){$('main').innerHTML=heading(t('ПРОФИЛЬ И ДАННЫЕ'),t('Самостоятельный просмотр'),t('Вы работаете без аккаунта. Прогресс и черновики остаются в этом браузере.'))+hx`<div class="paper prose"><h2>Ваши локальные данные</h2><p>Проверки выполнены в ${LESSONS.filter(l=>completed(l.id)).length} занятиях. Очистка данных браузера удалит этот прогресс. Аккаунт нужен для сохранения на локальном сервере и отправки работ учителю.</p><div class="form-actions"><button class="primary" data-action="auth">Войти</button><button data-action="export">Скачать мои результаты</button><button class="danger" data-action="clear-guest">Удалить гостевые данные</button></div></div>`;return;}
  $('main').innerHTML=heading(t('ПРОФИЛЬ И ДАННЫЕ'),account.user.name,t('Управляйте результатами и данными своей учётной записи.'))+hx`<div class="grid-two"><section class="paper"><h2>Учётная запись</h2><p style="margin-top:15px">Логин: <strong>${esc(account.user.username)}</strong></p><p>Роль: ${account.user.role==='teacher'?t('учитель'):t('ученик')}</p><p>Классов: ${account.classes.length}</p><div class="form-actions"><button data-action="export">Скачать мои данные</button><button class="danger" data-action="delete-account">Удалить аккаунт</button></div></section><section class="paper"><h2>Что сохраняется</h2><p style="margin-top:15px">Логин, отображаемое имя, роль, участие в классах, ответы на вопросы, код работ и комментарии учителя. Пароль хранится в виде производного значения с солью.</p><p style="margin-top:12px">Ученик видит свои результаты. Учитель видит работы учеников своих классов. В этой версии база находится на компьютере, где запущен сервер.</p><a href="#/about" style="display:inline-block;margin-top:15px">Ограничения первой версии →</a></section></div>`;
}
function renderAbout(){
  $('main').innerHTML=heading(t('ВЕРСИЯ 0.6'),t('Для самостоятельной проверки и обсуждения'),t('Курс на русском и казахском языках: школьный интерфейс, маршрут для новичка и исследование графа в 3D.'))+hx`<div class="paper prose"><h2>Что нового в версии 0.6</h2><p>Крупные карточки разделов, единые значки и понятный следующий шаг. В лаборатории управление собрано над графом. Исправлены ошибки восстановления данных, переключения экранов и работы с Python.</p><h2>Миссия BFS</h2><p>Добавлена экспериментальная миссия BFS «Передай сообщение»: ручное управление очередью, две сети, кратчайшие маршруты и объяснение результата. Прогресс миссии хранится в этом браузере отдельно для каждого пользователя. Итог можно скачать; это тренировочная попытка, не школьная оценка.</p><h2>Что можно проверить</h2><p>15 занятий, исследование разных графов, BFS, рекурсивный DFS, поиск пути, сравнение обходов, тренировки, выполнение Python и полный путь от назначения учителем до комментария к работе.</p><h2>Как устроены аккаунты</h2><p>Регистрация и вход работают на локальном сервере. Учитель создаёт класс, ученик присоединяется по коду. Для тестирования разрешён самостоятельный выбор роли учителя. Перед школьным пилотом этот процесс нужно заменить подтверждением преподавателей.</p><h2>Данные и доступ</h2><p>Данные аккаунтов сохраняются в локальной базе на компьютере сервера. Вы можете выгрузить свои результаты или удалить аккаунт вместе с попытками и работами. Удаление аккаунта учителя удаляет его классы и назначения, но не учётные записи учеников.</p><p>Черновики и гостевой прогресс также сохраняются в браузере. Не вводите в тестовую версию реальные сведения о школьниках. Для школьного пилота нужны согласованные правила обработки, размещения и удаления данных, восстановление доступа и проверка безопасности.</p><h2>Python</h2><p>Среда Python загружается с CDN jsDelivr. Браузер обращается к этому сервису для загрузки файлов; решения на него не отправляются. Ученический код выполняется в отдельной среде браузера с ограничением времени. Самопроверка кода не является защищённой итоговой аттестацией.</p><h2>Учебные материалы</h2><p>Тексты и задания — предварительная авторская редакция по предоставленной таблице целей. Преподавателю нужно проверить терминологию, сложность и соответствие утверждённой программе. Дейкстра включена как дополнительный пример; основа поиска пути в этой главе — BFS.</p><p>Занятие 31 (ТЖБ за четверть) не включено как отдельный экзамен: оно может охватывать другие разделы. Занятие 29 содержит тренировочную проверку, а не утверждённый вариант БЖБ.</p><h2>Проверка учебной пользы</h2><p>При тестировании отмечайте, какие объяснения понятны, на каких действиях возникают ошибки и помогает ли возврат по шагам. Для вывода об учебной эффективности потребуется отдельная методика и согласование с учителем.</p></div>`;
}
async function featureSubmit(form,data){
  const context=requestContext();
  if(form.id==='quiz-form'){
    const lessonId=ui.lesson.id,userId=account.user?.id||null,version=routeVersion;
    const answers=ui.lesson.questions.map((_,i)=>Number(data['q'+i]));ui.answers=answers;
    let result;
    if(account.user){result=await api('/quiz','POST',{lessonId,answers});if((account.user?.id||null)!==userId)return;account.progress=result.progress;}
    else{result=gradeQuiz(lessonId,answers);const list=progress(),previous=list.find(p=>p.lesson_id===lessonId);if(previous){previous.score=Math.max(previous.score,result.score);previous.attempts++;}else list.push({lesson_id:lessonId,score:result.score,total:result.total,attempts:1});storage.set('graph-guest-progress',list);}
    if(ui.lesson?.id!==lessonId||(account.user?.id||null)!==userId)return;
    ui.quizResult=result;
    if(version===routeVersion&&$('quiz-result')){$('quiz-result').innerHTML=quizResultHtml();$('quiz-result').scrollIntoView({block:'nearest'});}
  }else if(form.id==='path-form'){const parts=data.path.trim().split(/[\s,;→-]+/).map(Number),result=checkPath(GRAPH,parts,1,8);$('path-feedback').textContent=tRuntime(result.message);$('path-feedback').style.color=result.ok?'var(--teal)':'var(--red)';}
  else if(form.id==='join-form'){await api('/join','POST',{invite:data.invite});if(!sameAccount(context)||!await refreshAccount(context.userId)||!currentContext(context))return;renderAssignments();toast(t('Вы присоединились к классу.'));}
  else if(form.id==='class-form'){await api('/classes','POST',{name:data.name});if(!sameAccount(context)||!await refreshAccount(context.userId)||!currentContext(context,true))return;ui.classId=account.classes.at(-1)?.id;await renderTeacher(context.version);if(currentContext(context))toast(t('Класс создан.'));}
  else if(form.id==='assign-form'){await api('/assign','POST',{classId:context.classId,lessonId:Number(data.lessonId)});if(!currentContext(context,true))return;await renderTeacher(context.version);if(currentContext(context,true))toast(t('Занятие назначено классу.'));}
  else if(form.id==='feedback-form'){await api('/feedback','POST',{classId:context.classId,studentId:Number(form.dataset.student),lessonId:Number(form.dataset.lesson),comment:data.comment});if(!currentContext(context,true))return;if(form.isConnected)$('dialog').close();await renderTeacher(context.version);if(currentContext(context,true))toast(t('Комментарий сохранён и доступен ученику.'));}
  else if(form.id==='delete-form'){await api('/account','DELETE',{password:data.password});clearUserDrafts(account.user.id);await refreshAccount();ui.lesson=null;$('dialog').close();await route();toast(t('Аккаунт и связанные с ним данные удалены.'));}
}
function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function clearUserDrafts(id){const keys=new Set(memoryStorage.keys());try{for(let i=0;i<localStorage.length;i++)keys.add(localStorage.key(i));}catch{toast(t('Не удалось сохранить данные в браузере.'));}for(const key of keys)if(key?.startsWith(`graph-draft-${id}-`)||key?.startsWith(`graph-practice-${id}-`)||key?.startsWith(`graph-mission-${id}-`)||key===`graph-last-lesson-${id}`)storage.remove(key);}
async function featureAction(action,button){
  const context=requestContext();
  if(action==='start-prediction'){ui.tab='visual';if(['compare','explore'].includes(ui.mode))ui.mode='bfs';ui.predict=true;rebuildSteps();renderLesson();}
  else if(action==='reference'){openDialog(hx`<h2>Разобранный пример</h2><p class="dialog-subtitle">Сравните решение со своим. После просмотра попробуйте написать его самостоятельно на другом графе.</p><pre class="run-output">${esc(PYTHON[pythonKind()].reference)}</pre><button class="primary" style="margin-top:18px" data-action="load-reference">Загрузить в редактор</button>`);}
  else if(action==='load-reference'){invalidatePythonResult();$('python-code').value=PYTHON[pythonKind()].reference;saveVisibleDraft();$('dialog').close();toast(t('Пример загружен. Можно запустить и изучить результат.'));}
  else if(action==='reset-code'){if(confirm(t('Заменить код в редакторе начальным шаблоном?'))){invalidatePythonResult();$('python-code').value=PYTHON[pythonKind()].starter;saveVisibleDraft();}}
  else if(action==='run-python')runPython();
  else if(action==='stop-python')cancelPython();
  else if(action==='save-work'){
    if(button.disabled)return;
    const saved=saveVisibleDraft(true);
    if(!account.user){if(saved)toast(t('Черновик сохранён в этом браузере.'));return;}
    const payload={lessonId:ui.lesson.id,code:$('python-code').value,note:$('work-note').value,report:$('python-output').textContent};
    button.disabled=true;
    try{await api('/submission','POST',payload);if(currentContext(context))toast(t('Работа сохранена. Учитель вашего класса сможет открыть её.'));}finally{if(button.isConnected)button.disabled=false;}
  }
  else if(action==='copy-invite'){try{await navigator.clipboard.writeText(button.dataset.invite);toast(t('Код приглашения скопирован.'));}catch{toast(t('Код приглашения: ')+button.dataset.invite);}}
  else if(action==='refresh-teacher'){if(await refreshAccount(context.userId)&&currentContext(context,true))await renderTeacher(context.version);}
  else if(action==='review-work'){
    const student=ui.classResults.students.find(s=>s.id===Number(button.dataset.student)),work=student?.submissions.find(w=>w.lesson_id===Number(button.dataset.lesson));if(!work)throw Error(t('Обновите список работ.'));
    const fb=student.feedback.find(f=>f.lesson_id===work.lesson_id);
    openDialog(hx`<h2>${esc(student.name)} · занятие ${work.lesson_id}</h2><p class="small muted">Обновлено ${new Date(work.updated).toLocaleString(getLocale()==='kk'?'kk-KZ':'ru-RU')}</p><h3 style="margin-top:17px">Код решения</h3><pre class="run-output">${esc(work.code)}</pre><h3 style="margin-top:17px">Обоснование ученика</h3><p>${esc(work.note||t('Не добавлено'))}</p><details style="margin-top:16px"><summary>Самопроверка ученика</summary><pre class="run-output">${esc(work.report||t('Нет результата'))}</pre></details><form id="feedback-form" data-student="${student.id}" data-lesson="${work.lesson_id}"><label class="field">Комментарий учителя<textarea name="comment" rows="4" maxlength="2000" required>${esc(fb?.comment||'')}</textarea></label><p class="error-text" role="alert"></p><button class="primary" type="submit">Сохранить комментарий</button></form>`);
  }else if(action==='export'){const localMission=storage.get(missionKey(),null),data=context.userId!==null?await api('/export'):{guest:true,progress:progress(),drafts:LESSONS.map(l=>({lesson:l.id,...normalizeDraft(storage.get(draftKey(l.id),null))}))};if(!sameAccount(context))return;if(localMission){try{data.localMission=missionReport(restoreMissionRecord(localMission));}catch{data.localMission={error:'invalid-local-record'};}}download('graph-classroom-results.json',data);}
  else if(action==='clear-guest'){if(confirm(t('Удалить гостевые результаты и черновики в этом браузере?'))){storage.remove('graph-guest-progress');storage.remove('graph-last-lesson');clearUserDrafts('guest');ui.lesson=null;ui.answers=[];ui.quizResult=null;draftContext=null;renderProfile();}}
  else if(action==='delete-account'){openDialog(hx`<h2>Удалить учётную запись?</h2><p>Попытки, сохранённые работы и комментарии будут удалены. У учителя также удалятся его классы и назначения. Это действие нельзя отменить. Сначала можно скачать данные в профиле.</p><form id="delete-form"><label class="field">Введите пароль для подтверждения<input type="password" name="password" required maxlength="128" autocomplete="current-password"></label><p class="error-text" role="alert"></p><button class="danger" type="submit">Удалить мой аккаунт</button></form>`);}
}

function runPython(){
  if(currentRun)return;
  if(!runnerReady){toast(t('Среда Python ещё не готова. Обновите страницу и попробуйте снова.'));return;}
  const code=$('python-code').value;if(code.length>20000){toast(t('Максимум 20 000 символов кода.'));return;}
  saveVisibleDraft();currentRun={token:crypto.randomUUID(),lessonId:ui.lesson.id};
  $('run-python').disabled=true;$('stop-python').disabled=false;$('python-code').readOnly=true;$('python-output').textContent='';$('python-status').textContent=t('Подготавливаем Python…');
  const graph=Object.fromEntries(Object.entries(adjacency(ui.graph)).map(([k,neighbors])=>[k,neighbors.map(n=>n.id)]));
  pythonFrame.contentWindow.postMessage({type:'run',token:currentRun.token,code,kind:pythonKind(),graph},account.runnerOrigin);
}
function cancelPython(){if(!currentRun)return;pythonFrame.contentWindow.postMessage({type:'cancel',token:currentRun.token},account.runnerOrigin);currentRun=null;if($('run-python')){$('run-python').disabled=false;$('stop-python').disabled=true;$('python-code').readOnly=false;$('python-status').textContent=t('Выполнение остановлено.');}}
window.addEventListener('message',event=>{
  if(event.origin!==account.runnerOrigin||event.source!==pythonFrame.contentWindow)return;
  const d=event.data;
  if(d?.type==='runner-ready'){runnerReady=true;return;}
  if(!currentRun||d?.token!==currentRun.token)return;
  const visible=$('python-status')&&ui.lesson.id===currentRun.lessonId;
  if(d.type==='status'){if(visible)$('python-status').textContent=tRuntime(d.message);return;}
  if(['result','error','cancelled'].includes(d.type)){
    if(visible){$('run-python').disabled=false;$('stop-python').disabled=true;$('python-code').readOnly=false;
      if(d.type==='result'){const r=d.result;$('python-status').textContent=r.error?t('В коде возникла ошибка.'):tx`Проверок пройдено: ${r.passed} из ${r.total}.`;$('python-output').textContent=r.error||r.items.map(item=>tx`${item.ok?'✓':'✗'} ${tRuntime(item.name)}\n  Получено: ${item.name==='Использование рекурсивного вызова'?tRuntime(item.actual):item.actual}${item.ok?'':tx`\n  Ожидается: ${tRuntime(item.expected)}`}`).join('\n\n');if(d.stdout)$('python-output').textContent+=t('\n\nВывод программы:\n')+d.stdout;}
      else $('python-status').textContent=tRuntime(d.message)||t('Выполнение остановлено.');
    }else toast(d.type==='result'?t('Проверка Python завершилась. Вернитесь к заданию для повторного запуска.'):d.message||t('Выполнение остановлено.'));
    currentRun=null;
  }
});
// Опциональный WebMCP. Отсутствие API не влияет на обычную работу приложения.
if(document.modelContext?.registerTool){
  for(const tool of [
    {name:'read_course_progress',description:t('Прочитать список занятий и текущий прогресс без изменений.'),inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({lessons:LESSONS.map(l=>({id:l.id,title:l.title,completed:completed(l.id)}))})},
    {name:'open_graph_lesson',description:t('Открыть существующее занятие в интерфейсе. Не выполняет задания за ученика.'),inputSchema:{type:'object',properties:{lessonId:{type:'integer'}},required:['lessonId'],additionalProperties:false},execute:async input=>{if(!lessonById(input.lessonId))throw Error(t('Нет такого занятия.'));location.hash='/lesson/'+input.lessonId;await route();return {lessonId:ui.lesson.id,title:ui.lesson.title};}}
  ]){try{Promise.resolve(document.modelContext.registerTool(tool)).catch(()=>{});}catch{}}
}
