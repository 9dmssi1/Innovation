import test from 'node:test';
import assert from 'node:assert/strict';
import {requestJSON,ApiError} from '../public/api-client.js';
import {tRuntime} from '../public/i18n.js';

const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8',...headers}});

test('API client preserves JSON and sends one same-origin request with CSRF',async()=>{
  const payload={lessonId:21,code:'print("Қазақша")'};let count=0;
  const result=await requestJSON('/api/submission',{method:'POST',csrf:'fixture-csrf',data:payload,fetchImpl:async(url,options)=>{
    count++;assert.equal(url,'/api/submission');assert.equal(options.credentials,'same-origin');
    assert.equal(options.headers['X-CSRF-Token'],'fixture-csrf');assert.deepEqual(JSON.parse(options.body),payload);
    return json({ok:true});
  }});
  assert.deepEqual(result,{ok:true});assert.equal(count,1);
  assert.equal(await requestJSON('/api/submission?lesson=21',{fetchImpl:async()=>json(null)}),null);
});

test('Wrong account password and expired demo gate have distinguishable errors',async()=>{
  await assert.rejects(requestJSON('/api/login',{fetchImpl:async()=>json({error:'Неверный логин или пароль.'},401)}),error=>{
    assert(error instanceof ApiError);assert.equal(error.status,401);assert.equal(error.code,'http');
    assert.equal(error.message,'Неверный логин или пароль.');return true;
  });
  await assert.rejects(requestJSON('/api/me',{fetchImpl:async()=>new Response('internal gate detail',{status:401,headers:{'WWW-Authenticate':'Basic realm="Demo"'}})}),error=>{
    assert.equal(error.code,'demo-access');assert.equal(error.status,401);assert(!error.message.includes('internal'));return true;
  });
});

test('Proxy HTML and JSON 5xx details never appear in error messages',async()=>{
  for(const response of [new Response('<html>private-upstream-host secret</html>',{status:502}),json({error:'private database-path secret'},500)]){
    await assert.rejects(requestJSON('/api/me',{fetchImpl:async()=>response}),error=>{
      assert.equal(error.code,'unavailable');assert(!/private|secret|database/.test(error.message));
      assert.notEqual(tRuntime(error.message,'kk'),error.message);return true;
    });
  }
  for(const response of [new Response('<html>private details</html>',{headers:{'Content-Type':'text/html'}}),new Response('{broken secret',{headers:{'Content-Type':'application/json'}})]){
    await assert.rejects(requestJSON('/api/me',{fetchImpl:async()=>response}),error=>{
      assert.equal(error.code,'invalid-response');assert(!/private|secret|broken/.test(error.message));return true;
    });
  }
});

test('Network failure is recoverable without exposing transport internals',async()=>{
  let calls=0;
  const fetchImpl=async()=>{if(++calls===1)throw Error('TLS private path and token');return json({user:null});};
  await assert.rejects(requestJSON('/api/me',{fetchImpl}),error=>{
    assert.equal(error.code,'network');assert(!error.message.includes('private'));assert.notEqual(tRuntime(error.message,'kk'),error.message);return true;
  });
  assert.equal(calls,1,'The failing client does not retry on its own');
  assert.deepEqual(await requestJSON('/api/me',{fetchImpl}),{user:null});assert.equal(calls,2);
});

test('Timeout aborts a stalled write, never resubmits it, and permits a deliberate retry',async()=>{
  let calls=0,signal;
  const fetchImpl=async(url,options)=>{calls++;signal=options.signal;if(calls===1)return new Promise(()=>{});return json({ok:true});};
  await assert.rejects(requestJSON('/api/submission',{method:'POST',data:{code:'draft'},timeoutMs:20,fetchImpl}),error=>{
    assert.equal(error.code,'timeout');assert.notEqual(tRuntime(error.message,'kk'),error.message);return true;
  });
  assert(signal.aborted);assert.equal(calls,1);
  assert.deepEqual(await requestJSON('/api/submission',{method:'POST',data:{code:'draft'},fetchImpl}),{ok:true});
  assert.equal(calls,2);assert(!signal.aborted);
});

test('Timeout also bounds response body loading, not only HTTP headers',async()=>{
  let signal;
  await assert.rejects(requestJSON('/api/me',{timeoutMs:20,fetchImpl:async(url,options)=>{
    signal=options.signal;
    return {status:200,ok:true,headers:new Headers({'Content-Type':'application/json'}),json:()=>new Promise(()=>{})};
  }}),error=>error.code==='timeout');
  assert(signal.aborted);
});
