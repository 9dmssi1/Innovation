import test from 'node:test';
import assert from 'node:assert/strict';
import {GRAPH,copy,preset,trace,checkPath,graphFromText,validateGraph} from '../public/core.js';
import {LESSONS,gradeQuiz} from '../public/course.js';
function oracle(g,weighted){const ids=g.nodes.map(n=>n.id),d=Object.fromEntries(ids.map(a=>[a,Object.fromEntries(ids.map(b=>[b,a===b?0:Infinity]))]));for(const e of g.edges){d[e.a][e.b]=weighted?e.w:1;if(!g.directed)d[e.b][e.a]=weighted?e.w:1;}for(const k of ids)for(const a of ids)for(const b of ids)d[a][b]=Math.min(d[a][b],d[a][k]+d[k][b]);return d;}
test('BFS и Дейкстра совпадают с независимым алгоритмом Флойда—Уоршелла',()=>{
  for(const name of ['normal','directed','disconnected','branch']){const g=preset(name),before=JSON.stringify(g),unweighted=oracle(g,false),weighted=oracle(g,true);
    for(const {id:start} of g.nodes)for(const {id:target} of g.nodes){
      for(const algorithm of ['path','dijkstra']){const steps=trace(g,algorithm,start,target),last=steps.at(-1),expected=algorithm==='path'?unweighted:weighted;assert.equal(last.dist[target],Number.isFinite(expected[start][target])?expected[start][target]:null);if(last.path.length)assert(checkPath(g,last.path,start,target,algorithm==='dijkstra').ok);else assert.equal(expected[start][target],Infinity);assert.deepEqual(steps,trace(g,algorithm,start,target));}
      const bfs=trace(g,'bfs',start,target).at(-1),dfs=trace(g,'dfs',start,target).at(-1);assert.deepEqual([...bfs.order].sort(),[...dfs.order].sort());assert.equal(new Set(dfs.order).size,dfs.order.length);assert.equal(dfs.stack.length,0);
    }assert.equal(JSON.stringify(g),before);
  }
});
test('Снимки независимы, BFS избегает дублей, рекурсия возвращается',()=>{
  const steps=trace(copy(GRAPH),'bfs',1,9);const initial=JSON.stringify(steps[0]);steps[1].frontier.push(88);assert.equal(JSON.stringify(steps[0]),initial);
  const dfs=trace(copy(GRAPH),'dfs',1,9);assert(dfs.some(s=>s.kind==='return'&&s.current!==null));assert.equal(Math.max(...dfs.map(s=>s.stack.length)),dfs.at(-1).peak);
});
test('Разные оптимальные пути принимаются',()=>{assert(checkPath(GRAPH,[1,4,5,8],1,8).ok);assert(checkPath(GRAPH,[1,2,5,8],1,8).ok);assert(!checkPath(GRAPH,[1,8],1,8).ok);assert(!checkPath(GRAPH,[1,2,3,6,5,8],1,8).ok);assert(checkPath(GRAPH,[1],1,1).ok);});
test('Редактор валидирует вход',()=>{assert.equal(graphFromText(3,'1 2\n2 3 4',true).edges[0].w,1);assert.throws(()=>graphFromText(3,'1 1',false));assert.throws(()=>graphFromText(3,'1 4',false));assert.throws(()=>graphFromText(3,'1 2\n2 1',false));assert.throws(()=>graphFromText(3,'1 2 -1',false));assert.throws(()=>validateGraph({nodes:[],edges:[]}));});
test('Учебный план и оценка заданий',()=>{assert.equal(LESSONS.length,15);assert(!LESSONS.some(l=>l.id===31));for(const l of LESSONS){const result=gradeQuiz(l.id,l.questions.map(q=>q.answer));assert.equal(result.score,result.total);assert.throws(()=>gradeQuiz(l.id,[]));}});
