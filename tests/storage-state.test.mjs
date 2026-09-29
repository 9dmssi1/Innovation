import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProgress,normalizePractice,normalizeDraft,normalizeLastLesson} from '../public/storage-state.js';
import {LESSONS} from '../public/course.js';

test('Повреждённый локальный прогресс не ломает курс и не создаёт завершения',()=>{
  for(const raw of [null,{},'oops',42,[null,{},false]])assert.deepEqual(normalizeProgress(raw,LESSONS),[]);
  const raw=[{lesson_id:19,score:2,total:2,attempts:1},{lesson_id:19,score:1,total:2,attempts:3},{lesson_id:999,score:2,total:2},{lesson_id:20,score:3,total:2},{lesson_id:21,score:1,total:1},{lesson_id:22,score:'2',total:2}];
  const snapshot=structuredClone(raw);
  assert.deepEqual(normalizeProgress(raw,LESSONS),[{lesson_id:19,score:2,total:2,attempts:3}]);
  assert.deepEqual(raw,snapshot);
});

test('Ответы проверяются по реальным вариантам и остаются редактируемым массивом',()=>{
  const lesson=LESSONS.find(l=>l.id===19),raw={answers:'oops',path:{unexpected:true}};
  assert.deepEqual(normalizePractice(raw,lesson),{answers:[null,null],path:''});
  const valid=normalizePractice({answers:[1,0],path:'1 4 5 8'},lesson);valid.answers[0]=2;
  assert.deepEqual(normalizePractice({answers:[-1,99]},lesson).answers,[null,null]);
  assert.deepEqual(normalizePractice({answers:['1',null]},lesson).answers,[null,null]);
  assert.equal(normalizePractice({path:'1 4 5 8'},lesson).path,'1 4 5 8');
  assert.equal(raw.answers,'oops');
});

test('Черновики сохраняют настоящий текст без приведения объектов к строке или обрезания',()=>{
  assert.deepEqual(normalizeDraft({code:{bad:true},note:42,updated:'yesterday'},'# starter'),{code:'# starter',note:'',updated:0});
  const text='print("Қазақша")\n'.repeat(2000),raw={code:text,note:'Мой черновик',updated:1234};
  assert.deepEqual(normalizeDraft(raw),raw);assert.equal(raw.code,text);
  const clean=normalizeDraft(raw);clean.code='changed';assert.equal(raw.code,text);
  assert.deepEqual(normalizeDraft(null,'# starter'),{code:'# starter',note:'',updated:0});
  assert.equal(normalizeLastLesson(19,LESSONS),19);
  for(const value of ['19',{},null,31,999])assert.equal(normalizeLastLesson(value,LESSONS),null);
});
