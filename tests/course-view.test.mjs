import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseNextLesson,hasPassed,courseView} from '../public/course-view.js';
import {LESSONS,MODULES} from '../public/course.js';
import {setLocale,translateContent} from '../public/i18n.js';
test('Продолжение учитывает последнюю незавершённую проверку и конец главы',()=>{
  const checked=[{lesson_id:17,score:2,total:2}];
  assert.equal(chooseNextLesson(LESSONS,[],null).id,17);
  assert.equal(chooseNextLesson(LESSONS,[],24).id,24);
  assert.equal(chooseNextLesson(LESSONS,checked,17).id,18);
  assert.equal(chooseNextLesson(LESSONS,checked,999).id,18);
  assert.equal(hasPassed([{lesson_id:17,score:0,total:0}],17),false);
  const all=LESSONS.map(l=>({lesson_id:l.id,score:2,total:2}));assert.equal(chooseNextLesson(LESSONS,all,32).id,17);
});
test('Карта сохраняет все 15 ссылок и переводится без изменения номеров',()=>{
  for(const locale of ['ru','kk']){
    setLocale(locale);const output=courseView({modules:translateContent(MODULES),lessons:translateContent(LESSONS),progress:[],last:19,user:null});
    assert.equal((output.match(/data-course-lesson /g)||[]).length,15);
    for(const l of LESSONS)assert(output.includes(`href="#/lesson/${l.id}"`));
    assert(output.includes(locale==='kk'?'Тарау бағдарламасы':'Программа главы'));
    if(locale==='kk'){
      for(const russian of ['ВАШ СЛЕДУЮЩИЙ ШАГ','по учебному плану','Интерактивные графы и Python','С чего начать','КАК ПРОХОДИТ ЗАНЯТИЕ'])assert(!output.includes(russian),`Untranslated: ${russian}`);
    }
  }
  setLocale('ru');
});
