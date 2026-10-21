import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {StaticPython,demoText} from '../public/static-demo.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('Pages artifact supports a project subdirectory and excludes server data and custom domains',async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'graph-pages-test-'));
  try{
    await cp(path.join(root,'public'),path.join(folder,'public'),{recursive:true});
    await mkdir(path.join(folder,'scripts'));
    await cp(path.join(root,'scripts/build-pages.mjs'),path.join(folder,'scripts/build-pages.mjs'));
    await writeFile(path.join(folder,'CNAME'),'invalid.example');
    await writeFile(path.join(folder,'public','.env'),'fixture-secret');
    await writeFile(path.join(folder,'public','private.sqlite'),'fixture-db');
    execFileSync(process.execPath,[path.join(folder,'scripts/build-pages.mjs')]);
    const output=path.join(folder,'.pages-site'),files=await readdir(output);
    for(const excluded of ['CNAME','server.mjs','.env','private.sqlite','runner.html','runner.js'])assert.ok(!files.includes(excluded),excluded);
    const html=await readFile(path.join(output,'index.html'),'utf8');
    assert.doesNotMatch(html,/(?:href|src)="\//);
    for(const match of html.matchAll(/(?:href|src)="\.\/([^"#]+)"/g))await readFile(path.join(output,match[1]));
    assert.match(await readFile(path.join(output,'site-config.js'),'utf8'),/staticDemo=true/);
    assert.match(await readFile(path.join(root,'public/site-config.js'),'utf8'),/staticDemo=false/);
  }finally{
    assert.equal(path.dirname(path.resolve(folder)),path.resolve(tmpdir()));
    assert.match(path.basename(folder),/^graph-pages-test-/);
    await rm(folder,{recursive:true,force:true});
  }
});
test('Static Python cancellation ignores late fetches and terminates a running isolated worker',async t=>{
  let finishFetch,created=0,terminated=0,lastWorker;
  const previous=globalThis.Worker;
  globalThis.Worker=class{constructor(url){assert.ok(url.startsWith('data:text/javascript'));created++;lastWorker=this;}terminate(){terminated++;}postMessage(data){this.sent=data;}};
  t.after(()=>{if(previous===undefined)delete globalThis.Worker;else globalThis.Worker=previous;});
  t.mock.method(globalThis,'fetch',()=>new Promise(resolve=>{finishFetch=resolve;}));
  const events=[],runner=new StaticPython(message=>events.push(message));t.after(()=>runner.stop());
  const pending=runner.send({type:'run',token:'one',code:'pass',kind:'bfs',graph:{}});
  await runner.send({type:'cancel',token:'one'});
  finishFetch({ok:true,text:async()=>''});await pending;assert.equal(created,0);
  const next=runner.send({type:'run',token:'two',code:'pass',kind:'bfs',graph:{}});
  finishFetch({ok:true,text:async()=>''});await next;assert.equal(created,1);
  lastWorker.onmessage({data:{type:'ready'}});assert.equal(lastWorker.sent.code,'pass');
  await runner.send({type:'cancel',token:'two'});assert.equal(terminated,1);
  const length=events.length;lastWorker.onmessage({data:{type:'result',result:{}}});assert.equal(events.length,length);
  for(const key of ['badge','note','title'])assert.notEqual(demoText(key,'ru'),demoText(key,'kk'));
});
