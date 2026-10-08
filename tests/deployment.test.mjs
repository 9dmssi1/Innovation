import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import {serverConfig} from '../server-config.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=4394,runnerPort=4395;
const appOrigin='https://classroom.example',runnerOrigin='https://python.example';
// Fixtures for the temporary test server only; never deployed credentials.
const demoUser='reviewer',demoPassword='Deployment-Test-Only-2026!';
const basic='Basic '+Buffer.from(`${demoUser}:${demoPassword}`).toString('base64');
const validDemo={GRAPH_MODE:'demo',APP_ORIGIN:appOrigin,RUNNER_ORIGIN:runnerOrigin,
  DEMO_USER:demoUser,DEMO_PASSWORD:demoPassword,GRAPH_DB:path.join(tmpdir(),'unused-config-test.sqlite')};

test('Local configuration preserves loopback URLs, database and cookie defaults',()=>{
  const config=serverConfig({},root);
  assert.equal(config.mode,'local');
  assert.equal(config.host,'127.0.0.1');
  assert.equal(config.origin,'http://127.0.0.1:4318');
  assert.equal(config.runnerOrigin,'http://127.0.0.1:4319');
  assert.equal(config.dbFile,path.join(root,'.local','classroom.sqlite'));
  assert.equal(config.cookieName,'graph_session');
  assert.equal(config.secureCookie,'');
  const custom=serverConfig({PORT:'4400'},root);
  assert.equal(custom.runnerPort,4401);
  assert.equal(custom.origin,'http://127.0.0.1:4400');
  assert.throws(()=>serverConfig({GRAPH_BIND_HOST:'0.0.0.0'},root),/GRAPH_BIND_HOST/);
  assert.throws(()=>serverConfig({APP_ORIGIN:appOrigin},root),/APP_ORIGIN/);
});

test('Demo configuration requires explicit HTTPS origins on separate hostnames',()=>{
  const config=serverConfig({...validDemo,GRAPH_BIND_HOST:'0.0.0.0'},root);
  assert.equal(config.host,'0.0.0.0');
  assert.equal(config.origin,appOrigin);
  assert.equal(config.appHost,'classroom.example');
  assert.equal(config.runnerHost,'python.example');
  assert.equal(config.cookieName,'__Host-graph_session');
  assert.equal(config.secureCookie,'; Secure');
  assert.throws(()=>serverConfig({...validDemo,APP_ORIGIN:''},root),/APP_ORIGIN/);
  assert.throws(()=>serverConfig({...validDemo,RUNNER_ORIGIN:''},root),/RUNNER_ORIGIN/);
  for(const origin of ['http://classroom.example','https://classroom.example/','https://classroom.example/path',
    'https://classroom.example?query=1','https://classroom.example#fragment','https://user:password@classroom.example']){
    assert.throws(()=>serverConfig({...validDemo,APP_ORIGIN:origin},root),/APP_ORIGIN/);
  }
  assert.throws(()=>serverConfig({...validDemo,RUNNER_ORIGIN:appOrigin},root),/разные имена хостов/);
  assert.throws(()=>serverConfig({...validDemo,RUNNER_ORIGIN:appOrigin+':9443'},root),/разные имена хостов/);
});

test('Demo configuration rejects missing gate credentials and relative database paths',()=>{
  for(const invalid of [
    {DEMO_USER:''},{DEMO_USER:'ab'},{DEMO_USER:'with:colon'},
    {DEMO_PASSWORD:''},{DEMO_PASSWORD:'short'},{DEMO_PASSWORD:'x'.repeat(257)},
    {DEMO_PASSWORD:'long-password-with\nnewline'},
  ])assert.throws(()=>serverConfig({...validDemo,...invalid},root),/DEMO_USER/);
  for(const dbFile of ['', 'data/classroom.sqlite'])
    assert.throws(()=>serverConfig({...validDemo,GRAPH_DB:dbFile},root),/GRAPH_DB/);
});

test('Configuration rejects unknown modes and invalid or colliding ports',()=>{
  assert.throws(()=>serverConfig({GRAPH_MODE:'production'},root),/GRAPH_MODE/);
  for(const invalid of [{PORT:'80'},{PORT:'65536'},{PORT:'4318.5'},{PORT:'oops'},
    {PORT:'4394',RUNNER_PORT:'4394'},{RUNNER_PORT:'0'},{PORT:'65535'}])
    assert.throws(()=>serverConfig(invalid,root),/PORT/);
});

// Use HTTP only between the test client and backend. Exact Host/Origin values
// simulate the request forwarded by a TLS reverse proxy; this is not a TLS test.
function request(route,{runner=false,method='GET',headers={},data}={}){
  return new Promise((resolve,reject)=>{
    const bytes=data===undefined?undefined:Buffer.from(JSON.stringify(data));
    const req=http.request({hostname:'127.0.0.1',port:runner?runnerPort:port,path:route,method,
      headers:{Host:runner?'python.example':'classroom.example',
        ...(bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{}),...headers}},res=>{
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));
    });
    req.setTimeout(5000,()=>req.destroy(Error('Demo test request timed out')));
    req.on('error',reject);
    req.end(bytes);
  });
}

async function startServer(dbFile){
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,...validDemo,GRAPH_DB:dbFile,PORT:String(port),RUNNER_PORT:String(runnerPort),GRAPH_BIND_HOST:'127.0.0.1'}});
  let output='';
  try{
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>finish(Error('Demo server did not start; test ports 4394 and 4395 must be free.\n'+output)),10000);
      function finish(error){clearTimeout(timeout);child.off('exit',exited);child.off('error',failed);error?reject(error):resolve();}
      function exited(code){finish(Error(`Demo server exited (${code}).\n${output}`));}
      function failed(error){finish(error);}
      child.once('exit',exited);child.once('error',failed);
      child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('Откройте'))finish();});
      child.stderr.on('data',chunk=>{output+=chunk.toString();});
    });
    return child;
  }catch(error){await stopServer(child);throw error;}
}

async function stopServer(child){
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Test server did not stop'));},5000);
    child.once('exit',()=>{clearTimeout(timeout);resolve();});
    child.kill();
  });
}

test('Demo gate, origin isolation, secure sessions and persistent database work behind a proxy',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'graph-deployment-test-'));
  let child;
  try{
    const dbFile=path.join(temp,'demo.sqlite');
    child=await startServer(dbFile);

    for(const route of ['/', '/index.html','/app.js','/api/me']){
      const response=await request(route);
      assert.equal(response.status,401,route+' must require the demo gate');
      assert.match(response.headers['www-authenticate'],/^Basic\s/i);
      assert.equal(response.headers['cache-control'],'no-store');
    }
    const wrongHost=await request('/',{headers:{Host:'forged.example','X-Forwarded-Host':'classroom.example'}});
    assert.equal(wrongHost.status,403);
    assert.equal(wrongHost.headers['www-authenticate'],undefined);
    assert.equal((await request('/',{headers:{Authorization:'Basic '+Buffer.from(demoUser+':wrong-password').toString('base64')}})).status,401);

    const page=await request('/',{headers:{Authorization:basic}});
    assert.equal(page.status,200);
    assert.match(page.text,/<html/i);
    assert.equal(page.headers['cache-control'],'private, no-store');
    const script=await request('/app.js',{headers:{Authorization:basic}});
    assert.equal(script.status,200);
    assert.equal(script.headers['cache-control'],'private, no-store');
    assert.equal(typeof script.headers.etag,'string');
    for(const method of ['GET','HEAD']){
      const cachedWithoutGate=await request('/app.js',{method,headers:{'If-None-Match':script.headers.etag}});
      assert.equal(cachedWithoutGate.status,401,method+' must authenticate before checking ETag');
      assert.match(cachedWithoutGate.headers['www-authenticate'],/^Basic\s/i);
      if(method==='HEAD')assert.equal(cachedWithoutGate.text,'');
    }
    assert.equal(page.headers['content-security-policy'],
      `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src ${runnerOrigin}; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    const guest=await request('/api/me',{headers:{Authorization:basic}});
    assert.equal(guest.status,200);
    assert.equal(JSON.parse(guest.text).runnerOrigin,runnerOrigin);
    assert.equal(JSON.parse(guest.text).user,null);

    const runnerConfig=await request('/runner-config.js',{runner:true});
    assert.equal(runnerConfig.status,200);
    assert.match(runnerConfig.headers['content-type'],/javascript/);
    assert.match(runnerConfig.text,/export\s+const\s+parentOrigin\s*=/);
    const configModule=await import('data:text/javascript,'+encodeURIComponent(runnerConfig.text));
    assert.deepEqual(Object.keys(configModule),['parentOrigin']);
    assert.equal(configModule.parentOrigin,appOrigin);
    for(const secret of [demoUser,demoPassword,basic])assert(!runnerConfig.text.includes(secret));
    assert.equal(runnerConfig.headers['cache-control'],'no-store');
    assert.equal(runnerConfig.headers['content-security-policy'],
      `default-src 'none'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' https://cdn.jsdelivr.net; frame-ancestors ${appOrigin}; style-src 'self'; base-uri 'none'; form-action 'none'`);
    assert.equal((await request('/api/me',{runner:true})).status,404);
    assert.equal((await request('/app.js',{runner:true})).status,404);
    assert.equal((await request('/runner-config.js',{headers:{Authorization:basic}})).status,404);
    assert.equal((await request('/runner.html',{headers:{Authorization:basic}})).status,404);
    assert.equal((await request('/runner-config.js',{runner:true,headers:{Host:'forged.example'}})).status,403);
    const runnerHtml=await request('/',{runner:true});
    assert.equal(runnerHtml.status,200);
    assert.match(runnerHtml.text,/<script\b(?=[^>]*type=["']module["'])(?=[^>]*src=["'](?:\.\/|\/)?runner\.js["'])[^>]*>/);
    const runnerScript=await request('/runner.js',{runner:true});
    assert.equal(runnerScript.status,200);
    assert.match(runnerScript.text,/from\s*["'](?:\.\/|\/)runner-config\.js["']/);

    const account={username:'demo_student',name:'Deployment test',role:'student',password:'Only-A-Test-Account-2026!'};
    const trustedHeaders={Authorization:basic,Origin:appOrigin};
    const forged=await request('/api/register',{method:'POST',headers:{...trustedHeaders,Origin:'https://forged.example'},data:account});
    assert.equal(forged.status,403);
    const registered=await request('/api/register',{method:'POST',headers:trustedHeaders,data:account});
    assert.equal(registered.status,200);
    const registration=JSON.parse(registered.text);
    assert.equal(registration.user.username,account.username);
    const sessionCookie=registered.headers['set-cookie'][0];
    assert.match(sessionCookie,/^__Host-graph_session=[^;]+;/);
    for(const attribute of ['HttpOnly','SameSite=Strict','Path=/','Secure'])
      assert(sessionCookie.split(';').map(s=>s.trim()).includes(attribute));
    assert(!/\bDomain=/i.test(sessionCookie));
    const cookie=sessionCookie.split(';')[0];
    const loggedHeaders={...trustedHeaders,Cookie:cookie,'X-CSRF-Token':registration.csrf};
    const profile=await request('/api/me',{headers:loggedHeaders});
    assert.equal(JSON.parse(profile.text).user.id,registration.user.id);
    const work={lessonId:21,code:'def bfs(graph, start):\n    return [start]',
      note:'Сохранённая работа для проверки перезапуска',report:'Самопроверка: тестовый отчёт'};
    const saved=await request('/api/submission',{method:'POST',headers:loggedHeaders,data:work});
    assert.equal(saved.status,200);
    assert.equal((await request('/api/logout',{method:'POST',headers:{...loggedHeaders,'X-CSRF-Token':'forged'},data:{}})).status,403);
    assert.equal((await request('/api/logout',{method:'POST',headers:{...loggedHeaders,Origin:runnerOrigin},data:{}})).status,403);
    const logout=await request('/api/logout',{method:'POST',headers:loggedHeaders,data:{}});
    assert.equal(logout.status,200);
    assert.match(logout.headers['set-cookie'][0],/^__Host-graph_session=;/);
    assert.match(logout.headers['set-cookie'][0],/; Secure(?:;|$)/);
    assert.match(logout.headers['set-cookie'][0],/Max-Age=0/);
    assert.equal(JSON.parse((await request('/api/me',{headers:loggedHeaders})).text).user,null);

    // Restart with the same temporary disk, proving users and work survive replacement.
    await stopServer(child);child=null;
    child=await startServer(dbFile);
    const login=await request('/api/login',{method:'POST',headers:trustedHeaders,
      data:{username:account.username,password:account.password}});
    assert.equal(login.status,200);
    assert.equal(JSON.parse(login.text).user.id,registration.user.id);
    assert.match(login.headers['set-cookie'][0],/; Secure(?:;|$)/);
    const restartedHeaders={...trustedHeaders,Cookie:login.headers['set-cookie'][0].split(';')[0],
      'X-CSRF-Token':JSON.parse(login.text).csrf};
    const restored=await request('/api/submission?lesson=21',{headers:restartedHeaders});
    assert.equal(restored.status,200);
    const restoredWork=JSON.parse(restored.text);
    assert.equal(restoredWork.lesson_id,work.lessonId);
    assert.equal(restoredWork.user_id,registration.user.id);
    for(const field of ['code','note','report'])assert.equal(restoredWork[field],work[field]);
    const removed=await request('/api/account',{method:'DELETE',headers:restartedHeaders,data:{password:account.password}});
    assert.equal(removed.status,200);
    const cleared=removed.headers['set-cookie'][0];
    assert.match(cleared,/^__Host-graph_session=;/);
    for(const attribute of ['HttpOnly','SameSite=Strict','Path=/','Secure','Max-Age=0'])
      assert(cleared.split(';').map(s=>s.trim()).includes(attribute));
    assert(!/\bDomain=/i.test(cleared));
    assert.equal(JSON.parse((await request('/api/me',{headers:restartedHeaders})).text).user,null);
    assert.equal((await request('/api/login',{method:'POST',headers:trustedHeaders,
      data:{username:account.username,password:account.password}})).status,401);
  }finally{
    await stopServer(child);
    const resolved=path.resolve(temp),temporaryRoot=path.resolve(tmpdir())+path.sep;
    assert(resolved.startsWith(temporaryRoot)&&path.basename(resolved).startsWith('graph-deployment-test-'));
    await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
