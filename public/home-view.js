import {chooseNextLesson,hasPassed} from './course-view.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const copy={
  ru:{eyebrow:'ИНФОРМАТИКА · 11 КЛАСС',title:'Понимайте связи. Создавайте алгоритмы.',lead:'Интерактивная лаборатория, где графы становятся понятными через движение, эксперимент и собственный код.',start:'Начать с основ',continue:'Продолжить обучение',course:'Открыть карту курса',mission:'Попробовать миссию',why:'Учитесь через действие',whyLead:'Сначала увидьте идею, затем измените её своими руками и проверьте себя.',visual:'Исследуйте графы',visualText:'Вершины, рёбра и пути — на одной ясной схеме.',algorithm:'Разбирайте алгоритмы',algorithmText:'BFS, DFS и кратчайшие пути по шагам.',python:'Пишите на Python',pythonText:'Свяжите визуальный шаг с настоящим кодом.',journey:'Ваш маршрут обучения',journeyText:'Пять тем от первого графа до выбора алгоритма.',lesson:'занятие',done:'завершено',open:'Открыть',demo:'Демо · без регистрации'},
  kk:{eyebrow:'ИНФОРМАТИКА · 11-СЫНЫП',title:'Байланыстарды түсініңіз. Алгоритмдер құрыңыз.',lead:'Графтарды қозғалыс, тәжірибе және өз кодыңыз арқылы түсіндіретін интерактивті зертхана.',start:'Негіздерден бастау',continue:'Оқуды жалғастыру',course:'Курс картасын ашу',mission:'Миссияны байқап көру',why:'Әрекет арқылы үйреніңіз',whyLead:'Алдымен идеяны көріңіз, кейін оны өз қолыңызбен өзгертіп, өзіңізді тексеріңіз.',visual:'Графтарды зерттеңіз',visualText:'Төбелер, қабырғалар және жолдар бір түсінікті сызбада.',algorithm:'Алгоритмдерді талдаңыз',algorithmText:'BFS, DFS және ең қысқа жолды қадамдап көріңіз.',python:'Python тілінде жазыңыз',pythonText:'Көрнекі қадамды нақты кодпен байланыстырыңыз.',journey:'Оқу бағытыңыз',journeyText:'Алғашқы графтан алгоритм таңдауға дейінгі бес тақырып.',lesson:'сабақ',done:'аяқталды',open:'Ашу',demo:'Демо · тіркелусіз'}
};

function graphArt(){
  return `<svg class="home-graph-art" viewBox="0 0 560 430" role="img" aria-label="Граф: вершины и связи">
    <defs><linearGradient id="home-glow" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#b7a5ff"/><stop offset="1" stop-color="#7867e8"/></linearGradient><filter id="home-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#31226b" flood-opacity=".18"/></filter></defs>
    <path class="home-orbit" d="M88 252C120 105 318 46 456 136C534 187 501 319 381 365C240 418 70 369 88 252Z"/>
    <path class="home-edge" d="M125 272L205 125L342 164L443 267L315 327L125 272M205 125L315 327M342 164L315 327"/>
    <path class="home-edge home-edge-soft" d="M125 272L342 164M205 125L443 267"/>
    <g class="home-node home-node-purple" transform="translate(205 125)"><circle r="31"/><text y="8">1</text></g>
    <g class="home-node home-node-yellow" transform="translate(342 164)"><circle r="35"/><text y="8">2</text></g>
    <g class="home-node home-node-mint" transform="translate(125 272)"><circle r="27"/><text y="7">3</text></g>
    <g class="home-node home-node-coral" transform="translate(443 267)"><circle r="29"/><text y="7">4</text></g>
    <g class="home-node home-node-blue" transform="translate(315 327)"><circle r="34"/><text y="8">5</text></g>
    <g class="home-pill" transform="translate(73 55)"><rect width="146" height="37" rx="18"/><circle cx="22" cy="18" r="7"/><text x="38" y="24">STEP BY STEP</text></g>
    <g class="home-float-card" transform="translate(373 45)" filter="url(#home-shadow)"><rect width="126" height="80" rx="18"/><text x="18" y="25">BFS</text><text x="18" y="48">queue</text><path d="M18 63H94"/><circle cx="101" cy="63" r="5"/></g>
  </svg>`;
}

export function homeView({lessons,modules,progress,last,locale='ru',staticDemo=false}){
  const c=copy[locale==='kk'?'kk':'ru'];
  const done=lessons.filter(l=>hasPassed(progress,l.id)).length;
  const next=chooseNextLesson(lessons,progress,last);
  const nextIndex=Math.max(0,lessons.indexOf(next))+1;
  const allDone=done===lessons.length;
  const cards=[
    ['home-card-violet','01',c.visual,c.visualText,'#/lesson/17'],
    ['home-card-yellow','02',c.algorithm,c.algorithmText,'#/lesson/19'],
    ['home-card-mint','03',c.python,c.pythonText,'#/lesson/21/python']
  ];
  return `<div class="home-page">
    <section class="home-hero">
      <div class="home-hero-copy">
        <div class="home-hero-top"><p class="home-eyebrow">${esc(c.eyebrow)}</p><span class="home-demo-badge">${esc(c.demo)}</span></div>
        <h1>${esc(c.title)}</h1><p class="home-lead">${esc(c.lead)}</p>
        <div class="home-actions"><a class="home-button home-button-primary" href="#/lesson/${next.id}">${esc(allDone?c.continue:(last?c.continue:c.start))}<span aria-hidden="true">↗</span></a><a class="home-button home-button-quiet" href="#/course">${esc(c.course)}</a></div>
        <div class="home-proof"><span class="home-proof-mark">✓</span><span>${done} / ${lessons.length} ${esc(c.done)}</span><i style="--progress:${Math.round(done/lessons.length*100)}%"></i></div>
      </div><div class="home-hero-art">${graphArt()}</div>
    </section>
    <section class="home-section home-features"><div class="home-section-heading"><div><p class="home-eyebrow">${esc(c.why)}</p><h2>${esc(c.whyLead)}</h2></div><a href="#/mission" class="home-text-link">${esc(c.mission)} <span aria-hidden="true">↗</span></a></div>
      <div class="home-card-grid">${cards.map(([tone,num,title,text,href])=>`<a class="home-feature-card ${tone}" href="${href}"><span class="home-card-number">${num}</span><span class="home-card-icon" aria-hidden="true">${num==='01'?'◈':num==='02'?'↯':'⌘'}</span><h3>${esc(title)}</h3><p>${esc(text)}</p><span class="home-card-link">${esc(c.open)} <span aria-hidden="true">→</span></span></a>`).join('')}</div>
    </section>
    <section class="home-journey"><div class="home-journey-copy"><p class="home-eyebrow">${esc(c.journey)}</p><h2>${esc(next.title)}</h2><p>${esc(c.journeyText)}</p><a class="home-button home-button-dark" href="#/lesson/${next.id}">${esc(c.continue)} <span aria-hidden="true">→</span></a></div><div class="home-journey-track"><div class="home-track-line"><i style="--progress:${Math.max(8,Math.round(done/lessons.length*100))}%"></i></div><div class="home-track-steps">${modules.map((m,i)=>`<a href="#/lesson/${lessons.find(l=>l.module===m.id)?.id||17}" class="home-track-step ${i<Math.ceil(done/3)?'is-done':''}"><b>${String(i+1).padStart(2,'0')}</b><span>${esc(m.title)}</span></a>`).join('')}</div></div></section>
    <section class="home-mission-strip"><div><p class="home-eyebrow">${esc(c.mission)}</p><h2>${esc(c.visual)} · BFS</h2><p>${esc(c.whyLead)}</p></div><a class="home-button home-button-light" href="#/mission">${esc(c.mission)} <span aria-hidden="true">↗</span></a></section>
  </div>`;
}
