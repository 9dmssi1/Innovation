import test from 'node:test';
import assert from 'node:assert/strict';
import ru from '../public/locales/ru.js';
import kk from '../public/locales/kk.js';
import {t,tx,hx,tRuntime,setLocale,translateContent} from '../public/i18n.js';
import {LESSONS,PYTHON,gradeQuiz} from '../public/course.js';
import {GRAPH,trace} from '../public/core.js';
const tokens=s=>[...s.matchAll(/⟦\d+⟧/g)].map(m=>m[0]).sort();

test('Каждое сообщение имеет казахский перевод с теми же параметрами',()=>{
  assert.equal(Object.keys(kk).length,ru.length);
  ru.forEach((source,i)=>{assert.equal(typeof kk[i],'string',`Missing ${i}: ${source}`);assert(kk[i].length>0);assert.deepEqual(tokens(kk[i]),tokens(source),`Parameters ${i}`);});
});
test('Локализация 15 занятий сохраняет учебные цели, варианты и оценивание',()=>{
  const lessons=translateContent(LESSONS,'kk');assert.equal(lessons.length,15);
  for(let i=0;i<15;i++){
    const a=LESSONS[i],b=lessons[i];assert.equal(b.id,a.id);assert.equal(b.goal,a.goal);assert.equal(b.mode,a.mode);assert.notEqual(b.title,a.title);assert.notEqual(b.intro,a.intro);assert.notEqual(b.idea,a.idea);assert.notEqual(b.task,a.task);
    const answers=b.questions.map(q=>q.answer);assert.equal(gradeQuiz(b.id,answers).score,2);
    b.questions.forEach((q,j)=>{assert.notEqual(q.prompt,a.questions[j].prompt);assert.notEqual(q.explanation,a.questions[j].explanation);assert.equal(q.options.length,a.questions[j].options.length);});
  }
  const python=translateContent(PYTHON,'kk');for(const kind of ['bfs','dfs','path']){assert.equal(python[kind].reference,PYTHON[kind].reference);assert.equal(python[kind].signature,PYTHON[kind].signature);assert.notEqual(python[kind].starter,PYTHON[kind].starter);}
});
test('HTML переводит шаблон, сохраняя пользовательские имена и экранированный код',()=>{
  setLocale('kk');
  assert.equal(hx`<p>Учитель</p><p>${'Учитель'}</p><pre>${'&lt;script&gt;Привет&lt;/script&gt;'}</pre>`,'<p>Мұғалім</p><p>Учитель</p><pre>&lt;script&gt;Привет&lt;/script&gt;</pre>');
  assert.equal(tx`Вершина ${7}`,'7 төбесі');assert.equal(t('  Назад  '),'  Назад  ');
  setLocale('ru');assert.equal(tx`Вершина ${7}`,'Вершина 7');
});
test('BFS, DFS и Дейкстра объясняются на казахском без изменения снимков',()=>{
  for(const algorithm of ['bfs','dfs','dijkstra','path']){
    const steps=trace(GRAPH,algorithm,1,9),original=JSON.stringify(steps);
    for(const step of steps){
      assert.notEqual(tRuntime(step.title,'kk'),step.title,`${algorithm} title: ${step.title}`);
      assert.notEqual(tRuntime(step.text,'kk'),step.text,`${algorithm} text: ${step.text}`);
    }
    assert.equal(JSON.stringify(steps),original);
  }
});
