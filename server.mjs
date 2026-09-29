import http from 'node:http';
import {mkdir} from 'node:fs/promises';
import {serveStatic} from './static-files.mjs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomBytes,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {LESSONS,lessonById,gradeQuiz} from './public/course.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||4318),runnerPort=port+1;
if(!Number.isInteger(port)||port<1024||port>65534)throw Error('PORT должен быть целым числом 1024…65534.');
const origin=`http://127.0.0.1:${port}`,runnerOrigin=`http://127.0.0.1:${runnerPort}`;
const dbFile=process.env.GRAPH_DB||path.join(root,'.local','classroom.sqlite');
await mkdir(path.dirname(dbFile),{recursive:true});
const db=new DatabaseSync(dbFile);
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','teacher')), salt TEXT NOT NULL, password TEXT NOT NULL, created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS classes(id INTEGER PRIMARY KEY, teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, invite TEXT UNIQUE NOT NULL);
 CREATE TABLE IF NOT EXISTS members(class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(class_id,user_id));
 CREATE TABLE IF NOT EXISTS assignments(id INTEGER PRIMARY KEY,class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,lesson_id INTEGER NOT NULL,created TEXT NOT NULL,UNIQUE(class_id,lesson_id));
 CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,lesson_id INTEGER NOT NULL,score INTEGER NOT NULL,total INTEGER NOT NULL,answers TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS submissions(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,lesson_id INTEGER NOT NULL,code TEXT NOT NULL,note TEXT NOT NULL,report TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(user_id,lesson_id));
 CREATE TABLE IF NOT EXISTS feedback(class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,lesson_id INTEGER NOT NULL,comment TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(class_id,user_id,lesson_id));
 CREATE INDEX IF NOT EXISTS attempts_user ON attempts(user_id,lesson_id);`);
const hash=s=>createHash('sha256').update(s).digest('hex'),secret=()=>randomBytes(24).toString('base64url');
const derive=promisify(scrypt),now=()=>new Date().toISOString();
const fail=(status,message)=>{const e=new Error(message);e.status=status;throw e;};
const clean=(value,max=100)=>typeof value==='string'?value.trim().slice(0,max):'';
const userView=u=>u?{id:u.id,username:u.username,name:u.name,role:u.role}:null;
const rate=new Map();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
function headers(res,isRunner=false){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',isRunner
    ? `default-src 'none'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' https://cdn.jsdelivr.net; frame-ancestors ${origin}; style-src 'self'; base-uri 'none'; form-action 'none'`
    : `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src ${runnerOrigin}; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
}
function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
async function body(req){
  const parts=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>65536)fail(413,'Слишком большой запрос.');parts.push(chunk);}
  try{return JSON.parse(Buffer.concat(parts).toString()||'{}');}catch{fail(400,'Некорректный JSON.');}
}
function session(req){const raw=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('graph_session='))?.slice(14);if(!raw)return null;return db.prepare('SELECT s.csrf,s.token,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(hash(raw),Date.now());}
function requireUser(s,role){if(!s)fail(401,'Войдите в аккаунт.');if(role&&s.role!==role)fail(403,'Действие недоступно для этой роли.');}
function owner(s,id){requireUser(s,'teacher');const c=db.prepare('SELECT * FROM classes WHERE id=? AND teacher_id=?').get(Number(id),s.id);if(!c)fail(404,'Класс не найден.');return c;}
function progress(id){return db.prepare('SELECT lesson_id,MAX(score) AS score,MAX(total) AS total,COUNT(*) AS attempts FROM attempts WHERE user_id=? GROUP BY lesson_id').all(id);}
function classes(s){return s.role==='teacher'?db.prepare('SELECT c.*, (SELECT COUNT(*) FROM members m WHERE m.class_id=c.id) AS count FROM classes c WHERE teacher_id=?').all(s.id):db.prepare('SELECT c.id,c.name,u.name AS teacher FROM classes c JOIN members m ON m.class_id=c.id JOIN users u ON u.id=c.teacher_id WHERE m.user_id=?').all(s.id);}
function assignments(s){return db.prepare('SELECT a.*,c.name AS class_name FROM assignments a JOIN classes c ON a.class_id=c.id JOIN members m ON m.class_id=c.id WHERE m.user_id=? ORDER BY a.created DESC').all(s.id);}
function feedback(s){return db.prepare('SELECT f.*,c.name AS class_name FROM feedback f JOIN classes c ON c.id=f.class_id WHERE f.user_id=?').all(s.id);}
async function setSession(res,u){const token=secret(),csrf=secret();db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),u.id,csrf,Date.now()+7*86400000);res.setHeader('Set-Cookie',`graph_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);return {user:userView(u),csrf};}
async function verifyPassword(password,u){const bytes=await derive(password,u.salt,64);return timingSafeEqual(bytes,Buffer.from(u.password,'hex'));}
async function api(req,res,url){
  const s=session(req),route=url.pathname,method=req.method;
  if(method!=='GET'){
    if(req.headers.origin!==origin)fail(403,'Недопустимый источник запроса.');
    if(s&&!['/api/login','/api/register'].includes(route)&&req.headers['x-csrf-token']!==s.csrf)fail(403,'Обновите страницу и повторите действие.');
    if(!String(req.headers['content-type']||'').startsWith('application/json'))fail(415,'Ожидается JSON.');
  }
  if(route==='/api/me'&&method==='GET')return json(res,{user:userView(s),csrf:s?.csrf||'',runnerOrigin,progress:s?progress(s.id):[],classes:s?classes(s):[],assignments:s&&s.role==='student'?assignments(s):[],feedback:s?feedback(s):[]});
  if((route==='/api/login'||route==='/api/register')&&method==='POST'){
    const limitKey=req.socket.remoteAddress+route,time=Date.now();let bucket=rate.get(limitKey);if(!bucket||bucket.until<time){bucket={n:0,until:time+15*60000};rate.set(limitKey,bucket);}if(++bucket.n>30)fail(429,'Слишком много попыток. Повторите через 15 минут.');
    const data=await body(req),username=clean(data.username,40).toLowerCase(),password=typeof data.password==='string'?data.password:'';
    if(!/^[a-z0-9_.-]{3,40}$/.test(username)||password.length<10||password.length>128)fail(400,'Логин: 3–40 латинских символов, цифр, _ . -. Пароль: 10–128 символов.');
    let u=db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if(route==='/api/register'){
      if(u)fail(409,'Этот логин уже занят.');const role=data.role==='teacher'?'teacher':'student',name=clean(data.name,60)||username,salt=randomBytes(16).toString('hex'),passwordHash=(await derive(password,salt,64)).toString('hex');
      const result=db.prepare('INSERT INTO users(username,name,role,salt,password,created) VALUES(?,?,?,?,?,?)').run(username,name,role,salt,passwordHash,now());u=db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
    }else if(!u||!await verifyPassword(password,u))fail(401,'Неверный логин или пароль.');
    if(s)db.prepare('DELETE FROM sessions WHERE token=?').run(s.token);
    return json(res,await setSession(res,u));
  }
  requireUser(s);
  if(route==='/api/logout'&&method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(s.token);res.setHeader('Set-Cookie','graph_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,{ok:true});}
  if(route==='/api/quiz'&&method==='POST'){const data=await body(req);let result;try{result=gradeQuiz(data.lessonId,data.answers);}catch(e){fail(400,e.message);}db.prepare('INSERT INTO attempts(user_id,lesson_id,score,total,answers,created) VALUES(?,?,?,?,?,?)').run(s.id,Number(data.lessonId),result.score,result.total,JSON.stringify(data.answers),now());return json(res,{...result,progress:progress(s.id)});}
  if(route==='/api/submission'&&method==='POST'){const d=await body(req);if(!lessonById(d.lessonId))fail(400,'Урок не найден.');const code=clean(d.code,20000),note=clean(d.note,2000),report=clean(d.report,4000);db.prepare('INSERT INTO submissions VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,lesson_id) DO UPDATE SET code=excluded.code,note=excluded.note,report=excluded.report,updated=excluded.updated').run(s.id,Number(d.lessonId),code,note,report,now());return json(res,{ok:true});}
  if(route==='/api/submission'&&method==='GET'){const id=Number(url.searchParams.get('lesson'));return json(res,db.prepare('SELECT * FROM submissions WHERE user_id=? AND lesson_id=?').get(s.id,id)||null);}
  if(route==='/api/classes'&&method==='POST'){requireUser(s,'teacher');const d=await body(req),name=clean(d.name,60);if(!name)fail(400,'Введите название класса.');const invite=randomBytes(5).toString('hex').toUpperCase();db.prepare('INSERT INTO classes(teacher_id,name,invite) VALUES(?,?,?)').run(s.id,name,invite);return json(res,{classes:classes(s)});}
  if(route==='/api/join'&&method==='POST'){requireUser(s,'student');const d=await body(req),c=db.prepare('SELECT * FROM classes WHERE invite=?').get(clean(d.invite,20).toUpperCase());if(!c)fail(404,'Класс с таким кодом не найден.');db.prepare('INSERT OR IGNORE INTO members VALUES(?,?)').run(c.id,s.id);return json(res,{classes:classes(s),assignments:assignments(s)});}
  if(route==='/api/assign'&&method==='POST'){const d=await body(req);owner(s,d.classId);if(!lessonById(d.lessonId))fail(400,'Урок не найден.');db.prepare('INSERT OR IGNORE INTO assignments(class_id,lesson_id,created) VALUES(?,?,?)').run(Number(d.classId),Number(d.lessonId),now());return json(res,{ok:true});}
  if(route==='/api/results'&&method==='GET'){
    const c=owner(s,url.searchParams.get('class'));
    const members=db.prepare('SELECT u.id,u.name,u.username FROM users u JOIN members m ON m.user_id=u.id WHERE m.class_id=?').all(c.id);
    const assigned=db.prepare('SELECT * FROM assignments WHERE class_id=?').all(c.id),lessonIds=new Set(assigned.map(a=>a.lesson_id));
    const students=members.map(u=>({...u,progress:progress(u.id).filter(p=>lessonIds.has(p.lesson_id)),submissions:db.prepare('SELECT lesson_id,code,note,report,updated FROM submissions WHERE user_id=? AND lesson_id IN (SELECT lesson_id FROM assignments WHERE class_id=?)').all(u.id,c.id),feedback:db.prepare('SELECT * FROM feedback WHERE user_id=? AND class_id=?').all(u.id,c.id).filter(f=>lessonIds.has(f.lesson_id))}));
    return json(res,{class:c,students,assignments:assigned});
  }
  if(route==='/api/feedback'&&method==='POST'){const d=await body(req);owner(s,d.classId);if(!db.prepare('SELECT 1 FROM members WHERE class_id=? AND user_id=?').get(Number(d.classId),Number(d.studentId)))fail(404,'Ученик не найден в этом классе.');if(!lessonById(d.lessonId))fail(400,'Урок не найден.');if(!db.prepare('SELECT 1 FROM assignments WHERE class_id=? AND lesson_id=?').get(Number(d.classId),Number(d.lessonId)))fail(403,'Занятие не назначено этому классу.');const comment=clean(d.comment,2000);if(!comment)fail(400,'Введите комментарий.');db.prepare('INSERT INTO feedback VALUES(?,?,?,?,?) ON CONFLICT(class_id,user_id,lesson_id) DO UPDATE SET comment=excluded.comment,updated=excluded.updated').run(Number(d.classId),Number(d.studentId),Number(d.lessonId),comment,now());return json(res,{ok:true});}
  if(route==='/api/export'&&method==='GET')return json(res,{user:userView(s),attempts:db.prepare('SELECT lesson_id,score,total,answers,created FROM attempts WHERE user_id=?').all(s.id),submissions:db.prepare('SELECT lesson_id,code,note,report,updated FROM submissions WHERE user_id=?').all(s.id),feedback:feedback(s)});
  if(route==='/api/account'&&method==='DELETE'){const d=await body(req);if(typeof d.password!=='string'||d.password.length>128||!await verifyPassword(d.password,s))fail(403,'Пароль не совпадает.');db.prepare('DELETE FROM users WHERE id=?').run(s.id);res.setHeader('Set-Cookie','graph_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,{ok:true});}
  fail(404,'Запрос не найден.');
}
async function serve(req,res,isRunner=false){
  headers(res,isRunner);
  try{
    const expected=isRunner?`127.0.0.1:${runnerPort}`:`127.0.0.1:${port}`;
    if(req.headers.host!==expected)fail(403,'Откройте приложение по адресу 127.0.0.1 из инструкции.');
    const url=new URL(req.url,isRunner?runnerOrigin:origin);
    if(!isRunner&&url.pathname.startsWith('/api/'))return await api(req,res,url);
    if(req.method!=='GET'&&req.method!=='HEAD')fail(405,'Метод не поддерживается.');
    const relative=decodeURIComponent(url.pathname==='/'?(isRunner?'/runner.html':'/index.html'):url.pathname);
    const allowedRunner=['/runner.html','/runner.js','/python-worker.js'];
    if(isRunner&&!allowedRunner.includes(relative))fail(404,'Не найдено.');
    if(!isRunner&&allowedRunner.includes(relative))fail(404,'Не найдено.');
    const full=path.resolve(root,'public','.'+relative),base=path.join(root,'public')+path.sep;
    if(!full.startsWith(base)||!mime[path.extname(full)])fail(404,'Не найдено.');
    try{await serveStatic(req,res,full,mime[path.extname(full)]);}catch(e){if(['ENOENT','ENOTDIR','EISDIR'].includes(e.code))fail(404,'Файл не найден.');throw e;}
  }catch(e){if(!res.headersSent)json(res,{error:e.status?e.message:'Внутренняя ошибка. Повторите действие.'},e.status||500);else res.end();if(!e.status)console.error(e);}
}
const main=http.createServer((q,s)=>serve(q,s,false)),runner=http.createServer((q,s)=>serve(q,s,true));
for(const server of [main,runner])server.on('error',e=>{console.error(`Не удалось запустить: ${e.code}. Закройте другой экземпляр или задайте PORT.`);process.exitCode=1;main.close();runner.close();});
runner.listen(runnerPort,'127.0.0.1',()=>main.listen(port,'127.0.0.1',()=>console.log(`Graph Classroom v0.5\nОткройте ${origin}\nPython: ${runnerOrigin}\nОстановка: Ctrl+C`)));
function shutdown(){main.close();runner.close();db.close();process.exit(0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
