// Карта курса: чистое представление и выбор следующего занятия, без DOM.
import {t,tx,hx} from './i18n.js';
import {icon,courseIllustration} from './icons.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const hasPassed=(progress,id)=>Array.isArray(progress)&&progress.some(p=>p&&p.lesson_id===id&&Number.isInteger(p.total)&&p.total>0&&p.score===p.total);
export function chooseNextLesson(lessons,progress,last){
  const recent=lessons.find(l=>l.id===Number(last));
  return recent&&!hasPassed(progress,recent.id)?recent:lessons.find(l=>!hasPassed(progress,l.id))||lessons[0];
}
export function courseView({modules,lessons,progress,last,user}){
  const done=lessons.filter(l=>hasPassed(progress,l.id)).length;
  const next=chooseNextLesson(lessons,progress,last),allDone=done===lessons.length;
  return hx`<header class="course-heading"><div><p class="eyebrow">ИНФОРМАТИКА · 11 КЛАСС</p><h1>Алгоритмы на графах</h1><p>Понимайте связи. Исследуйте алгоритмы. Пишите свой код.</p></div></header>
    <div class="course-facts"><span>${icon('book')} <strong>5</strong> разделов</span><span><strong>15</strong> занятий</span><span><strong>30</strong> вопросов</span><span>${icon('code')} ${t('Интерактивные графы и Python')}</span></div>
    <div class="course-overview"><section class="resume-card"><div class="resume-copy"><p class="eyebrow">${allDone?t('МОЖНО ПОВТОРИТЬ'):t('ВАШ СЛЕДУЮЩИЙ ШАГ')}</p><span class="resume-number">${String(lessons.indexOf(next)+1).padStart(2,'0')} / ${lessons.length}</span><h2>${esc(next.title)}</h2><p>${esc(next.intro)}</p><a class="button-link primary" href="#/lesson/${next.id}">${allDone?t('Повторить занятие'):last?t('Продолжить обучение'):t('Начать с основ')} ${icon('arrow')}</a></div>${courseIllustration()}</section>
    <section class="course-progress"><span class="progress-symbol" aria-hidden="true">${icon('check')}</span><h2>Проверки понимания</h2><div class="progress-heading"><strong>${done}<span> / ${lessons.length}</span></strong><span>${Math.round(done/lessons.length*100)}%</span></div><div class="progress-track" role="progressbar" aria-label="Завершённые занятия" aria-valuenow="${done}" aria-valuemin="0" aria-valuemax="${lessons.length}"><i style="width:${done/lessons.length*100}%"></i></div><p>Счётчик учитывает ответы на вопросы. Практическую работу оценивает учитель.</p></section></div>
    <div class="course-workspace"><section class="curriculum" aria-labelledby="curriculum-title"><div class="course-section-heading"><div><h2 id="curriculum-title">Программа главы</h2><p>Выберите занятие или продолжите с места остановки.</p></div></div>
      <label class="course-search">${icon('search')}<span class="sr-only">Найти занятие</span><input id="course-search" type="search" placeholder="Название, BFS, DFS или номер занятия" autocomplete="off"></label>
      <div id="course-list">${modules.map((module,index)=>{
        const rows=lessons.filter(l=>l.module===module.id),passed=rows.filter(l=>hasPassed(progress,l.id)).length;
        return hx`<section class="course-module tone-${esc(module.color)}" data-course-module><header><span class="module-symbol">${icon(module.id)}</span><div class="module-heading-copy"><p class="module-kicker">${esc(tx`РАЗДЕЛ ${String(index+1).padStart(2,'0')}`)}</p><h3>${esc(module.title)}</h3><p>${esc(module.subtitle)}</p></div><span class="module-count" aria-label="${esc(tx`Проверки: ${passed} из ${rows.length}`)}">${icon('check')} ${passed}/${rows.length}</span></header><div>${rows.map(l=>{
          const checked=hasPassed(progress,l.id),current=!allDone&&l.id===next.id;
          const state=checked?t('Проверка пройдена'):current?t('Продолжить'):t('Открыть');
          return hx`<a class="course-lesson ${checked?'is-complete':''} ${current?'is-current':''}" data-course-lesson data-search="${esc(`${l.id} ${l.title} ${l.mode} ${module.title}`.toLowerCase())}" href="#/lesson/${l.id}"><span class="lesson-sequence">${checked?icon('check'):String(lessons.indexOf(l)+1).padStart(2,'0')}</span><span class="lesson-text"><strong>${esc(l.title)}</strong><small>№ ${l.id} по учебному плану</small></span><span class="lesson-status">${state}</span><span class="lesson-arrow">${icon('arrow')}</span></a>`;
        }).join('')}</div></section>`;
      }).join('')}</div><p id="course-empty" class="empty" role="status" hidden>Ничего не найдено. Попробуйте другое название или номер.</p></section>
      <aside class="course-aside"><section class="course-help-card"><span class="help-symbol">${icon('book')}</span><h2>Впервые изучаете графы?</h2><p>Понятные примеры и словарь терминов</p><a class="button-link secondary" href="#/start">${t('С чего начать')} ${icon('arrow')}</a></section>
      <section class="course-method"><p class="eyebrow">КАК ПРОХОДИТ ЗАНЯТИЕ</p><ol><li><span>1</span><div><strong>Исследуйте</strong><p>Меняйте граф и разбирайте каждый шаг.</p></div></li><li><span>2</span><div><strong>Объясняйте</strong><p>Предсказывайте действия и проверяйте себя.</p></div></li><li><span>3</span><div><strong>Применяйте</strong><p>Решайте задачи и пишите код на Python.</p></div></li></ol></section>
      <p class="course-storage">${user?t('Работы и результаты доступны в вашем аккаунте.'):t('Без регистрации. Результаты сохраняются в этом браузере.')}</p></aside></div>`;
}
