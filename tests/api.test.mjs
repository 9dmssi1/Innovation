import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import {gunzipSync} from 'node:zlib';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),port=4390,base=`http://127.0.0.1:${port}`;
let child,temp;
before(async()=>{temp=await mkdtemp(path.join(tmpdir(),'graph-classroom-test-'));child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),GRAPH_DB:path.join(temp,'test.sqlite')},stdio:['ignore','pipe','pipe'],windowsHide:true});await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Локальный сервер не запустился. Порт 4390 должен быть свободен.')),10000);child.stdout.on('data',data=>{if(data.toString().includes('Откройте')){clearTimeout(timeout);resolve();}});child.on('exit',code=>{clearTimeout(timeout);reject(Error('Server exited: '+code));});});});
after(async()=>{if(child){await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}if(temp){const resolved=path.resolve(temp);assert(resolved.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(resolved).startsWith('graph-classroom-test-'));await rm(resolved,{recursive:true,force:true});}});
async function client(username,role){
  const state={cookie:'',csrf:''};
  const request=async(route,method='GET',data,headers={})=>{const response=await fetch(base+'/api'+route,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:state.cookie,'X-CSRF-Token':state.csrf,...headers},body:data===undefined?undefined:JSON.stringify(data)});const cookie=response.headers.get('set-cookie');if(cookie)state.cookie=cookie.split(';')[0];const body=await response.json();if(body.csrf)state.csrf=body.csrf;return {status:response.status,body};};
  const registered=await request('/register','POST',{username,name:username,role,password:'LongTestPassword2026'});assert.equal(registered.status,200);
  return {request,state,user:registered.body.user};
}
test('Учитель → класс → ученик → ответы → работа → комментарий; границы доступа',async()=>{
  const teacher=await client('teacher_a','teacher'),other=await client('teacher_b','teacher'),student=await client('student_a','student');
  const made=await teacher.request('/classes','POST',{name:'11 А'});assert.equal(made.status,200);const c=made.body.classes[0];
  assert.equal((await teacher.request('/assign','POST',{classId:c.id,lessonId:21})).status,200);
  assert.equal((await student.request('/join','POST',{invite:c.invite})).status,200);
  assert.equal((await other.request('/results?class='+c.id)).status,404);
  assert.equal((await student.request('/results?class='+c.id)).status,403);
  assert.equal((await student.request('/classes','POST',{name:'Нельзя'})).status,403);
  assert.equal((await student.request('/quiz','POST',{lessonId:21,answers:[1,1]}, {'X-CSRF-Token':''})).status,403);
  assert.equal((await student.request('/quiz','POST',{lessonId:21,answers:[1,1]}, {Origin:'http://example.org'})).status,403);
  assert.equal((await student.request('/quiz','POST',{lessonId:21,answers:[0,0],score:999})).body.score,0);
  assert.equal((await student.request('/quiz','POST',{lessonId:21,answers:[1,1]})).body.score,2);
  assert.equal((await student.request('/submission','POST',{lessonId:21,code:'def bfs(g, s): return [s]',note:'Тест',report:'Самопроверка'})).status,200);
  // Один ученик в двух классах: учителя видят только назначенные своему классу уроки.
  const second=(await other.request('/classes','POST',{name:'Другой класс'})).body.classes[0];
  await other.request('/assign','POST',{classId:second.id,lessonId:24});
  await student.request('/join','POST',{invite:second.invite});
  await student.request('/quiz','POST',{lessonId:24,answers:[0,0]});
  await student.request('/submission','POST',{lessonId:24,code:'def dfs(g, s): return [s]',note:'Работа другого класса',report:''});
  const results=await teacher.request('/results?class='+c.id);assert.equal(results.body.students.length,1);assert.equal(results.body.students[0].submissions[0].note,'Тест');
  assert.deepEqual(results.body.students[0].submissions.map(w=>w.lesson_id),[21]);
  assert.deepEqual(results.body.students[0].progress.map(p=>p.lesson_id),[21]);
  const otherResults=(await other.request('/results?class='+second.id)).body;
  assert.deepEqual(otherResults.students[0].submissions.map(w=>w.lesson_id),[24]);
  assert.equal((await teacher.request('/feedback','POST',{classId:c.id,studentId:student.user.id,lessonId:24,comment:'Не назначено'})).status,403);
  assert.equal((await other.request('/feedback','POST',{classId:c.id,studentId:student.user.id,lessonId:21,comment:'Нельзя'})).status,404);
  assert.equal((await teacher.request('/feedback','POST',{classId:c.id,studentId:student.user.id,lessonId:21,comment:'Допишите очередь.'})).status,200);
  assert.equal((await student.request('/me')).body.feedback[0].comment,'Допишите очередь.');
  const exported=(await student.request('/export')).body;assert(!('password' in exported.user));assert(!('salt' in exported.user));assert.equal(exported.submissions.length,2);
  const oldCookie=student.state.cookie;await student.request('/logout','POST',{});student.state.cookie=oldCookie;assert.equal((await student.request('/export')).status,401);
  await student.request('/login','POST',{username:'student_a',password:'LongTestPassword2026'});assert.equal((await student.request('/submission?lesson=21')).body.note,'Тест');
  assert.equal((await student.request('/account','DELETE',{password:'wrong'})).status,403);
  assert.equal((await student.request('/account','DELETE',{password:'LongTestPassword2026'})).status,200);
  assert.equal((await student.request('/me')).body.user,null);
  assert.equal((await teacher.request('/results?class='+c.id)).body.students.length,0);
});

function rawRequest(route,headers={},method='GET'){
  return new Promise((resolve,reject)=>{const req=http.request(base+route,{headers,method},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,data:Buffer.concat(chunks)}));});req.on('error',reject);req.end();});
}
test('Статические файлы сжимаются и проверяются по ETag; API не кэшируется',async()=>{
  const plain=await rawRequest('/app.js',{'Accept-Encoding':'identity'}),compressed=await rawRequest('/app.js',{'Accept-Encoding':'gzip'});
  assert.equal(plain.status,200);assert.equal(compressed.headers['content-encoding'],'gzip');
  assert.deepEqual(gunzipSync(compressed.data),plain.data);assert(compressed.data.length<plain.data.length*.5);
  assert.notEqual(plain.headers.etag,compressed.headers.etag);
  const cached=await rawRequest('/app.js',{'Accept-Encoding':'gzip','If-None-Match':compressed.headers.etag});assert.equal(cached.status,304);assert.equal(cached.data.length,0);
  const head=await rawRequest('/app.js',{'Accept-Encoding':'gzip'},'HEAD');assert.equal(head.data.length,0);assert.equal(Number(head.headers['content-length']),compressed.data.length);
  const disallowed=await rawRequest('/app.js',{'Accept-Encoding':'gzip;q=0, *;q=1'});assert.equal(disallowed.headers['content-encoding'],undefined);
  const me=await rawRequest('/api/me',{'Accept-Encoding':'gzip'});assert.equal(me.headers['cache-control'],'no-store');assert.equal(me.headers.etag,undefined);
});
