import test from 'node:test';
import assert from 'node:assert/strict';
import {GRAPH,copy,trace} from '../public/core.js';
import {spatialLayout,project,unproject,INITIAL_CAMERA} from '../public/spatial.js';
import {graphFile,parseGraphFile} from '../public/graph-file.js';

test('XYZ-проекция обратима при разных поворотах и масштабах',()=>{
  const positions=spatialLayout(GRAPH.nodes);
  assert(new Set(Object.values(positions).map(p=>p.z)).size>3);
  for(const yaw of [-3,-1,0,1,3])for(const pitch of [-1.4,0,1.4])for(const zoom of [0.55,1,1.45]){
    const camera={yaw,pitch,zoom};
    for(const p of Object.values(positions)){
      const q=project(p,camera),restored=unproject(q.x,q.y,q.z,camera);
      for(const axis of ['x','y','z'])assert(Math.abs(p[axis]-restored[axis])<1e-8);
      assert(Number.isFinite(q.x)&&Number.isFinite(q.y)&&q.scale>0);
    }
  }
});
test('Поворот и перемещение 3D не меняют граф и шаги алгоритмов',()=>{
  const graph=copy(GRAPH),before=copy(graph),steps=trace(graph,'dijkstra',1,9);
  const positions=spatialLayout(graph.nodes);positions[1]={x:100,y:120,z:200};
  for(const p of Object.values(positions))project(p,{...INITIAL_CAMERA,yaw:2});
  assert.deepEqual(graph,before);assert.deepEqual(trace(graph,'dijkstra',1,9),steps);
});
test('Переносимый граф проходит круг сохранения; повреждённый файл отклоняется',()=>{
  const graph=copy(GRAPH);graph.account={password:'must-not-export'};
  const serialized=JSON.stringify(graphFile(graph));
  assert(!serialized.includes('account'));assert.deepEqual(parseGraphFile(serialized),GRAPH);
  for(const invalid of ['{}','null','not json','x'.repeat(32769)])assert.throws(()=>parseGraphFile(invalid));
  const malformed=graphFile(GRAPH);malformed.graph.edges[0].w=-1;
  assert.throws(()=>parseGraphFile(JSON.stringify(malformed)));
  malformed.graph.edges[0].w=9;malformed.graph.directed='false';
  assert.throws(()=>parseGraphFile(JSON.stringify(malformed)));
});
