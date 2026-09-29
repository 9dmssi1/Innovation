'use strict';
// Версия зафиксирована. Новый Worker на каждую проверку исключает перенос состояния.
const CDN='https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
let pyodide,stdout='';
async function boot(){
  try{importScripts(CDN+'pyodide.js');pyodide=await loadPyodide({indexURL:CDN,stdout:s=>{if(stdout.length<4000)stdout+=s+'\n';},stderr:s=>{if(stdout.length<4000)stdout+=s+'\n';}});postMessage({type:'ready'});}catch(e){postMessage({type:'error',message:'Не удалось загрузить Python: '+String(e.message).slice(0,300)});}
}
onmessage=async event=>{
  const d=event.data;
  try{
    pyodide.globals.set('student_source',d.code);pyodide.globals.set('task_kind',d.kind);pyodide.globals.set('custom_graph_json',JSON.stringify(d.graph));
    const result=await pyodide.runPythonAsync(`
import json, ast, traceback
from collections import deque

def reference_bfs(g, start):
    q = deque([start]); seen = {start}; result = []
    while q:
        u = q.popleft(); result.append(u)
        for v in sorted(g[u]):
            if v not in seen:
                seen.add(v); q.append(v)
    return result

def reference_dfs(g, start):
    seen = set(); result = []
    def visit(u):
        seen.add(u); result.append(u)
        for v in sorted(g[u]):
            if v not in seen: visit(v)
    visit(start)
    return result

def distance(g, start, target):
    q = deque([start]); dist = {start: 0}
    while q:
        u = q.popleft()
        if u == target: return dist[u]
        for v in g[u]:
            if v not in dist:
                dist[v] = dist[u]+1; q.append(v)
    return None

namespace = {}
report = []
try:
    compiled = compile(student_source, 'solution.py', 'exec')
    exec(compiled, namespace)
    function_name = {'bfs':'bfs', 'dfs':'dfs', 'path':'shortest_path'}[task_kind]
    function = namespace.get(function_name)
    if not callable(function):
        raise ValueError('Не найдена функция ' + function_name)
    custom = {int(k): v for k, v in json.loads(custom_graph_json).items()}
    keys = sorted(custom)
    cases = [
      ('Текущий граф', custom, keys[0], keys[-1]),
      ('Развилка', {1:[2,3],2:[1,4],3:[1],4:[2]}, 1, 4),
      ('Цикл', {1:[2,3],2:[1,3],3:[1,2,4],4:[3]}, 1, 4),
      ('Недостижимая цель', {1:[2],2:[1],3:[]}, 1, 3),
      ('Старт совпадает с целью', {1:[2],2:[1]}, 2, 2),
      ('Одна вершина', {1:[]}, 1, 1),
      ('Направленные переходы', {1:[2,3],2:[4],3:[4],4:[]}, 1, 4),
      ('Два кратчайших пути', {1:[2,3],2:[1,4],3:[1,4],4:[2,3]}, 1, 4)
    ]
    for name, graph, start, target in cases:
        try:
            expected = reference_bfs(graph,start) if task_kind == 'bfs' else reference_dfs(graph,start) if task_kind == 'dfs' else distance(graph,start,target)
            actual = function({k:list(v) for k,v in graph.items()},start,target) if task_kind == 'path' else function({k:list(v) for k,v in graph.items()},start)
            valid_list = isinstance(actual,list) and all(type(v) is int for v in actual)
            if task_kind == 'path':
                ok = valid_list and (actual == [] if expected is None else len(actual) == expected+1 and actual[0] == start and actual[-1] == target and all(b in graph.get(a,[]) for a,b in zip(actual,actual[1:])))
                expected_text = '[]' if expected is None else 'Допустимый путь из '+str(expected)+' рёбер'
            else:
                ok = valid_list and actual == expected
                expected_text = repr(expected)
            report.append({'name':name,'ok':bool(ok),'actual':repr(actual)[:400],'expected':expected_text})
        except Exception as e:
            report.append({'name':name,'ok':False,'actual':type(e).__name__+': '+str(e)[:300],'expected':'Выполнение без ошибки'})
    if task_kind == 'dfs':
        tree = ast.parse(student_source)
        recursive = any(isinstance(node, ast.FunctionDef) and any(isinstance(call,ast.Call) and isinstance(call.func,ast.Name) and call.func.id == node.name for call in ast.walk(node)) for node in ast.walk(tree))
        report.append({'name':'Использование рекурсивного вызова','ok':recursive,'actual':'Найден' if recursive else 'Не найден','expected':'Рекурсивная функция DFS'})
    answer = {'items':report,'passed':sum(x['ok'] for x in report),'total':len(report)}
except Exception:
    answer = {'items':[],'passed':0,'total':0,'error':traceback.format_exc(limit=3)[-1600:]}
json.dumps(answer, ensure_ascii=False)
`);
    postMessage({type:'result',result:JSON.parse(result),stdout});
  }catch(e){postMessage({type:'error',message:String(e.message).slice(0,1500)});}
};
boot();
