import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,mkdir,chmod,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {serverConfig} from '../server-config.mjs';
import {WindowLimiter,clientAddress} from '../server-security.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=4396,runnerPort=4397;
const origin='https://operations.example',runnerOrigin='https://operations-python.example';
// Credentials below exist only inside isolated, temporary test fixtures.
const demoUser='operations_reviewer',demoPassword='Operations-Fixture-Only-2026!';
const basic='Basic '+Buffer.from(demoUser+':'+demoPassword).toString('base64');
const baseConfig={GRAPH_MODE:'demo',APP_ORIGIN:origin,RUNNER_ORIGIN:runnerOrigin,
  DEMO_USER:demoUser,GRAPH_DB:path.join(tmpdir(),'unused-operations-config.sqlite')};

async function removeFixture(directory){
  const resolved=path.resolve(directory),temporaryRoot=path.resolve(tmpdir())+path.sep;
  assert(resolved.startsWith(temporaryRoot)&&path.basename(resolved).startsWith('graph-operations-test-'));
  await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}

test('Hosting secret files preserve the password and strip only one terminal line ending',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'graph-operations-test-'));
  try{
    const secretFile=path.join(temp,'demo-password.txt');
    for(const ending of ['', '\n', '\r\n']){
      await writeFile(secretFile,demoPassword+ending,{mode:0o600});
      const config=serverConfig({...baseConfig,DEMO_PASSWORD_FILE:secretFile},root);
      assert.equal(config.demoPassword,demoPassword);
      assert.equal(config.trustProxy,false);
    }
    await writeFile(secretFile,' '+demoPassword+' \n');
    assert.equal(serverConfig({...baseConfig,DEMO_PASSWORD_FILE:secretFile},root).demoPassword,' '+demoPassword+' ');
    await writeFile(secretFile,demoPassword+'\n\n');
    assert.throws(()=>serverConfig({...baseConfig,DEMO_PASSWORD_FILE:secretFile},root),/DEMO_PASSWORD/);
    assert.throws(()=>serverConfig({...baseConfig,DEMO_PASSWORD:demoPassword,DEMO_PASSWORD_FILE:secretFile},root),
      error=>/только DEMO_PASSWORD/.test(error.message)&&!error.message.includes(demoPassword));
  }finally{await removeFixture(temp);}
});

test('Unreadable and oversized secret files fail without exposing contents or paths',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'graph-operations-test-'));
  try{
    const oversized=path.join(temp,'oversized-secret.txt'),directory=path.join(temp,'not-a-file');
    await writeFile(oversized,demoPassword.repeat(100));
    await mkdir(directory);
    for(const file of [oversized,directory,path.join(temp,'missing-secret.txt')]){
      assert.throws(()=>serverConfig({...baseConfig,DEMO_PASSWORD_FILE:file},root),error=>
        /Не удалось прочитать DEMO_PASSWORD_FILE/.test(error.message)&&
        !error.message.includes(demoPassword)&&!error.message.includes(file));
    }
    // Windows ACLs do not implement POSIX chmod(000); exercise that case on Linux CI.
    if(process.platform!=='win32'&&process.getuid?.()!==0){
      const forbidden=path.join(temp,'unreadable-secret.txt');
      await writeFile(forbidden,demoPassword,{mode:0o600});
      await chmod(forbidden,0);
      try{
        assert.throws(()=>serverConfig({...baseConfig,DEMO_PASSWORD_FILE:forbidden},root),/Не удалось прочитать DEMO_PASSWORD_FILE/);
      }finally{await chmod(forbidden,0o600);}
    }
  }finally{await removeFixture(temp);}
});

test('Proxy address trust is opt-in for hosted mode only',()=>{
  assert.equal(serverConfig({...baseConfig,DEMO_PASSWORD:demoPassword,GRAPH_TRUST_PROXY:'1'},root).trustProxy,true);
  assert.throws(()=>serverConfig({GRAPH_TRUST_PROXY:'1'},root),/GRAPH_TRUST_PROXY/);
  for(const value of ['true','yes','2','-1'])
    assert.throws(()=>serverConfig({...baseConfig,DEMO_PASSWORD:demoPassword,GRAPH_TRUST_PROXY:value},root),/GRAPH_TRUST_PROXY/);
  const req={socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'203.0.113.8','x-graph-client-ip':'198.51.100.4'}};
  assert.equal(clientAddress(req),'127.0.0.1');
  assert.equal(clientAddress(req,true),'198.51.100.4');
  for(const invalid of ['198.51.100.4, 203.0.113.8',' 198.51.100.4','198.51.100.4:123','not-an-ip',['198.51.100.4'],undefined]){
    req.headers['x-graph-client-ip']=invalid;
    assert.equal(clientAddress(req,true),'127.0.0.1');
  }
  req.headers['x-graph-client-ip']='2001:db8::4';
  assert.equal(clientAddress(req,true),'2001:db8::4');
  assert.equal(clientAddress({headers:{'x-forwarded-for':'203.0.113.8'},socket:{}},true),'unknown');
});

test('Rate limiter expires windows, bounds memory and reclaims expired entries',()=>{
  const limiter=new WindowLimiter({windowMs:100,maxEntries:2});
  assert.equal(limiter.take('a',2,0),true);
  assert.equal(limiter.take('a',2,1),true);
  assert.equal(limiter.take('a',2,2),false);
  assert.equal(limiter.take('b',1,10),true);
  for(let i=0;i<100;i++)assert.equal(limiter.take('new-'+i,10,20),false);
  assert.equal(limiter.entries.size,2);
  limiter.prune(99);
  assert.equal(limiter.entries.size,2);
  assert.equal(limiter.take('c',1,100),true);
  assert.equal(limiter.entries.has('a'),false);
  assert.equal(limiter.entries.has('b'),true);
  assert.equal(limiter.entries.size,2);
  assert.equal(limiter.take('b',1,110),true);
  assert.equal(limiter.take('b',1,111),false);
  limiter.prune(210);
  assert.equal(limiter.entries.size,0);
});

function request(route,{method='GET',headers={},raw,chunked=false}={}){
  return new Promise((resolve,reject)=>{
    const bytes=raw===undefined?undefined:Buffer.from(raw);
    const req=http.request({hostname:'127.0.0.1',port,path:route,method,agent:false,
      headers:{Host:'operations.example',Connection:'close',
        ...(bytes?{'Content-Type':'application/json',...(chunked?{'Transfer-Encoding':'chunked'}:{'Content-Length':bytes.length})}:{}),...headers}},res=>{
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));
    });
    req.setTimeout(5000,()=>req.destroy(Error('Operations test request timed out')));
    req.on('error',reject);
    if(chunked&&bytes){for(let offset=0;offset<bytes.length;offset+=16384)req.write(bytes.subarray(offset,offset+16384));req.end();}
    else req.end(bytes);
  });
}

async function startServer(env){
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';
  try{
    await new Promise((resolve,reject)=>{
      let settled=false;
      const timeout=setTimeout(()=>finish(Error('Operations server did not start; ports 4396/4397 must be free.\n'+output)),10000);
      function finish(error){if(settled)return;settled=true;clearTimeout(timeout);child.off('exit',exited);child.off('error',failed);error?reject(error):resolve();}
      function exited(code){finish(Error(`Operations server exited (${code}).\n${output}`));}
      function failed(error){finish(error);}
      child.once('exit',exited);child.once('error',failed);
      child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('Откройте'))finish();});
      child.stderr.on('data',chunk=>{output+=chunk.toString();});
    });
    assert(!output.includes(demoPassword),'Startup output must not contain gate credentials');
    return child;
  }catch(error){await stopServer(child);throw error;}
}

async function stopServer(child){
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Operations server did not stop'));},12000);
    child.once('exit',()=>{clearTimeout(timeout);resolve();});
    child.kill();
  });
}

function runHealthcheck(env){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['scripts/healthcheck.mjs'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';
    const timeout=setTimeout(()=>{child.kill();reject(Error('Healthcheck subprocess timed out'));},8000);
    child.stdout.on('data',chunk=>{output+=chunk.toString();});
    child.stderr.on('data',chunk=>{output+=chunk.toString();});
    child.once('error',error=>{clearTimeout(timeout);reject(error);});
    child.once('exit',code=>{clearTimeout(timeout);resolve({code,output});});
  });
}

test('Hosted server handles malformed requests, concurrent writes and operational recovery',async t=>{
  const temp=await mkdtemp(path.join(tmpdir(),'graph-operations-test-'));
  const dbFile=path.join(temp,'operations.sqlite'),secretFile=path.join(temp,'gate.txt');
  await writeFile(secretFile,demoPassword+'\n',{mode:0o600});
  const env={...process.env,...baseConfig,GRAPH_DB:dbFile,DEMO_PASSWORD_FILE:secretFile,
    PORT:String(port),RUNNER_PORT:String(runnerPort),GRAPH_BIND_HOST:'127.0.0.1',GRAPH_TRUST_PROXY:'1'};
  delete env.DEMO_PASSWORD;
  const trustedHeaders={Authorization:basic,Origin:origin,'X-Graph-Client-IP':'198.51.100.10'};
  let child;
  const healthy=async()=>{
    const response=await request('/healthz',{headers:{Authorization:basic}});
    assert.equal(response.status,200);
    assert.equal(JSON.parse(response.text).ok,true);
    return response;
  };
  try{
    child=await startServer(env);

    await t.test('Health probes are private and the container health script checks both servers',async()=>{
      assert.equal((await request('/healthz')).status,401);
      assert.equal((await request('/healthz',{headers:{Authorization:'Basic '+Buffer.from(demoUser+':wrong').toString('base64')}})).status,401);
      const response=await healthy();
      const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
      assert.deepEqual(JSON.parse(response.text),{ok:true,version});
      assert.equal(response.headers['cache-control'],'no-store');
      assert(!response.text.includes(demoPassword));
      const result=await runHealthcheck(env);
      assert.equal(result.code,0,result.output);
      assert(!result.output.includes(demoPassword));
    });

    await t.test('Invalid JSON shapes and oversized fixed/chunked bodies yield 4xx without crashing',async()=>{
      for(const raw of ['null','[]','"text"','42','true','{broken']){
        const response=await request('/api/register',{method:'POST',headers:trustedHeaders,raw});
        assert.equal(response.status,400,raw);
        await healthy();
      }
      const raw=JSON.stringify({padding:'x'.repeat(70000)});
      for(const chunked of [false,true]){
        const response=await request('/api/register',{method:'POST',headers:trustedHeaders,raw,chunked});
        assert.equal(response.status,413,chunked?'chunked body':'Content-Length body');
        await healthy();
      }
    });

    await t.test('Concurrent registration of one username has one winner and conflict responses',async()=>{
      const account={username:'concurrent_student',name:'Concurrent fixture',role:'student',password:'Concurrent-Fixture-2026!'};
      const responses=await Promise.all(Array.from({length:4},()=>request('/api/register',{
        method:'POST',headers:{...trustedHeaders,'X-Graph-Client-IP':'198.51.100.11'},raw:JSON.stringify(account)})));
      assert.deepEqual(responses.map(r=>r.status).sort(),[200,409,409,409]);
      await healthy();
    });

    await t.test('Trusted edge addresses get separate registration rate-limit buckets',async()=>{
      for(let i=0;i<30;i++){
        const response=await request('/api/register',{method:'POST',
          headers:{...trustedHeaders,'X-Graph-Client-IP':'198.51.100.20'},raw:'{}'});
        assert.equal(response.status,400,'invalid attempt '+(i+1));
      }
      const limited=await request('/api/register',{method:'POST',headers:{...trustedHeaders,'X-Graph-Client-IP':'198.51.100.20'},raw:'{}'});
      assert.equal(limited.status,429);
      assert.equal(limited.headers['retry-after'],'900');
      assert.equal((await request('/api/register',{method:'POST',headers:{...trustedHeaders,'X-Graph-Client-IP':'198.51.100.21'},raw:'{}'})).status,400);
      await healthy();
    });

    await t.test('Restart removes expired sessions and preserves a live session',async()=>{
      await stopServer(child);child=null;
      const liveToken='live-operations-fixture-token',expiredToken='expired-operations-fixture-token';
      const digest=value=>createHash('sha256').update(value).digest('hex');
      const db=new DatabaseSync(dbFile);
      try{
        const id=db.prepare('INSERT INTO users(username,name,role,salt,password,created) VALUES(?,?,?,?,?,?)')
          .run('session_fixture','Session fixture','student','unused-fixture-salt','unused-fixture-hash',new Date().toISOString()).lastInsertRowid;
        const insert=db.prepare('INSERT INTO sessions(token,user_id,csrf,expires) VALUES(?,?,?,?)');
        insert.run(digest(expiredToken),id,'expired-csrf',Date.now()-1000);
        insert.run(digest(liveToken),id,'live-csrf',Date.now()+3600000);
      }finally{db.close();}
      child=await startServer(env);
      const readDb=new DatabaseSync(dbFile,{readOnly:true});
      try{
        assert.equal(readDb.prepare('SELECT COUNT(*) AS count FROM sessions WHERE token=?').get(digest(expiredToken)).count,0);
        assert.equal(readDb.prepare('SELECT COUNT(*) AS count FROM sessions WHERE token=?').get(digest(liveToken)).count,1);
      }finally{readDb.close();}
      const live=await request('/api/me',{headers:{Authorization:basic,Cookie:'__Host-graph_session='+liveToken}});
      assert.equal(live.status,200);
      assert.equal(JSON.parse(live.text).user.username,'session_fixture');
      const expired=await request('/api/me',{headers:{Authorization:basic,Cookie:'__Host-graph_session='+expiredToken}});
      assert.equal(JSON.parse(expired.text).user,null);
      await healthy();
    });
  }finally{
    await stopServer(child);
    await removeFixture(temp);
  }
});
