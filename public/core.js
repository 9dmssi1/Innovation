// Чистая модель: без DOM, сети и хранения. Каждый шаг — независимый снимок.
export const GRAPH = Object.freeze({directed:false,nodes:[
  {id:1,x:95,y:65},{id:2,x:360,y:65},{id:3,x:625,y:65},
  {id:4,x:95,y:180},{id:5,x:360,y:180},{id:6,x:625,y:180},
  {id:7,x:95,y:295},{id:8,x:360,y:295},{id:9,x:625,y:295}
],edges:[{a:1,b:2,w:9},{a:2,b:3,w:2},{a:1,b:4,w:2},{a:2,b:5,w:2},{a:3,b:6,w:3},{a:4,b:5,w:1},{a:5,b:6,w:8},{a:4,b:7,w:4},{a:5,b:8,w:2},{a:6,b:9,w:1},{a:7,b:8,w:1},{a:8,b:9,w:8}]});
export const copy = value => JSON.parse(JSON.stringify(value));
export const key = (a,b,directed=false) => directed?`${a}>${b}`:[a,b].sort((x,y)=>x-y).join('-');
export function adjacency(graph) {
  const map=Object.fromEntries(graph.nodes.map(n=>[n.id,[]]));
  for(const e of graph.edges){map[e.a].push({id:e.b,w:e.w});if(!graph.directed)map[e.b].push({id:e.a,w:e.w});}
  Object.values(map).forEach(list=>list.sort((a,b)=>a.id-b.id));return map;
}
export function validateGraph(g) {
  if(!g||!Array.isArray(g.nodes)||!Array.isArray(g.edges)||g.nodes.length<2||g.nodes.length>12)throw Error('Нужно от 2 до 12 вершин.');
  const ids=g.nodes.map(n=>n.id);
  if(new Set(ids).size!==ids.length||ids.some(id=>!Number.isInteger(id)||id<1||id>99))throw Error('Номера вершин должны быть уникальными числами от 1 до 99.');
  if(g.edges.length>40)throw Error('Максимум 40 рёбер.');
  const seen=new Set();
  for(const e of g.edges){if(!ids.includes(e.a)||!ids.includes(e.b)||e.a===e.b||!Number.isInteger(e.w)||e.w<1||e.w>99)throw Error('Проверьте концы рёбер и положительные целые веса.');const k=key(e.a,e.b,g.directed);if(seen.has(k))throw Error('Повторяющиеся рёбра не поддерживаются.');seen.add(k);}
  for(const n of g.nodes)if(!Number.isFinite(n.x)||!Number.isFinite(n.y)||n.x<40||n.x>680||n.y<45||n.y>310)throw Error('Координаты вершины вне области графа.');
  return g;
}
export function preset(name) {
  const g=copy(GRAPH);
  if(name==='directed')g.directed=true;
  if(name==='disconnected')g.edges=g.edges.filter(e=>![3,6,9].includes(e.a)&&![3,6,9].includes(e.b));
  if(name==='branch')g.edges=[{a:1,b:2,w:1},{a:1,b:4,w:1},{a:2,b:3,w:1},{a:2,b:5,w:1},{a:4,b:7,w:1},{a:5,b:6,w:1},{a:5,b:8,w:1},{a:8,b:9,w:1}];
  return g;
}
export function graphFromText(count,text,directed) {
  if(!Number.isInteger(count)||count<2||count>12)throw Error('Нужно целое число вершин от 2 до 12.');
  const cols=Math.ceil(Math.sqrt(count)),rows=Math.ceil(count/cols);
  const nodes=Array.from({length:count},(_,i)=>({id:i+1,x:80+(i%cols)*560/Math.max(1,cols-1),y:65+Math.floor(i/cols)*230/Math.max(1,rows-1)}));
  const edges=text.trim()?text.trim().split(/\n/).map(line=>{
    const fields=line.trim().split(/[\s,;]+/).map(Number);
    if(fields.length<2||fields.length>3||fields.some(n=>!Number.isFinite(n)))throw Error('В каждой строке: начало конец [вес]. Например: 1 2 3');
    return {a:fields[0],b:fields[1],w:fields[2]??1};
  }):[];
  return validateGraph({nodes,edges,directed});
}
export function trace(graph, algorithm='bfs', start=1, target=9) {
  validateGraph(graph);
  if(!graph.nodes.some(n=>n.id===start)||!graph.nodes.some(n=>n.id===target))throw Error('Старт или цель отсутствует.');
  const adj=adjacency(graph),steps=[];
  const state={current:null,frontier:[],stack:[],done:[],order:[],dist:Object.fromEntries(graph.nodes.map(n=>[n.id,null])),parent:{},active:[],path:[],checks:0,peak:0,code:[],kind:'init'};
  const emit=(kind,title,text,fields={})=>{Object.assign(state,{kind,title,text,active:[],code:[],...fields});state.peak=Math.max(state.peak,state.frontier.length,state.stack.length);steps.push(copy(state));};
  state.dist[start]=0;
  if(algorithm==='dfs'){
    emit('init','Погружаемся в граф','Начинаем со старта. Каждый рекурсивный вызов запоминает, куда нужно вернуться.',{code:[1]});
    const visit=u=>{
      state.stack.push(u);state.order.push(u);
      emit('enter',`Входим в вершину ${u}`,`Добавляем вызов dfs(${u}) в стек. Глубина вызовов: ${state.stack.length}.`,{current:u,code:[2,3,4]});
      for(const {id:v} of adj[u]){state.checks++;if(state.dist[v]!==null){emit('skip',`Сосед ${v} уже открыт`,'Повторный вызов не нужен: это защищает обход от зацикливания.',{current:u,active:[key(u,v,graph.directed)],code:[5,6]});continue;}
        state.parent[v]=u;state.dist[v]=state.dist[u]+1;
        emit('descend',`Из ${u} идём в ${v}`,`Приостанавливаем вызов dfs(${u}) и начинаем dfs(${v}).`,{current:u,active:[key(u,v,graph.directed)],next:v,code:[5,6,7]});visit(v);
      }
      state.done.push(u);state.stack.pop();
      const back=state.stack.at(-1)??null;
      emit('return',`Завершаем dfs(${u})`,back===null?'Стек пуст: вернулись из стартового вызова.':`Возвращаемся к dfs(${back}) и продолжаем просмотр его соседей.`,{current:back,code:[8]});
    };visit(start);
    emit('done','Обход в глубину завершён',`Порядок открытия: ${state.order.join(' → ')}. Открыто ${state.order.length} из ${graph.nodes.length} вершин.`,{current:null,code:[]});
  }else if(algorithm==='dijkstra'){
    const refresh=u=>state.frontier=graph.nodes.map(n=>n.id).filter(v=>v!==u&&!state.done.includes(v)&&state.dist[v]!==null).sort((a,b)=>state.dist[a]-state.dist[b]||a-b);
    refresh(null);emit('init','Начальные расстояния',`До ${start} — 0. До остальных — ∞. Выбираем минимальную сумму весов.`,{code:[1]});
    while(state.frontier.length){const u=state.frontier[0];refresh(u);
      emit('select',`Выбираем вершину ${u}`,`Расстояние ${state.dist[u]} минимально среди ещё не обработанных. При равенстве выбираем меньший номер.`,{current:u,code:[3]});
      for(const {id:v,w} of adj[u]){state.checks++;if(state.done.includes(v))continue;const before=state.dist[v],candidate=state.dist[u]+w,updated=before===null||candidate<before;
        if(updated){state.dist[v]=candidate;state.parent[v]=u;}refresh(u);
        emit('relax',updated?`Улучшаем расстояние до ${v}`:`Проверяем соседа ${v}`,`${state.dist[u]} + ${w} = ${candidate}. ${updated?`Было ${before??'∞'}, стало ${candidate}.`:`Оставляем ${before}: новый путь не короче.`}`,{current:u,active:[key(u,v,graph.directed)],change:{from:u,to:v,before,candidate,after:state.dist[v],updated},code:[4,5,6]});
      }
      state.done.push(u);state.order.push(u);refresh(null);emit('settle',`Вершина ${u} обработана`,'Её соседи проверены. Продолжаем выбор наименьшего расстояния.',{current:null,code:[7]});
    }
  }else{
    state.frontier=[start];emit('init','Начинаем со старта',`В очереди только ${start}. Его уровень равен 0.`,{code:[1,2]});
    while(state.frontier.length){const u=state.frontier.shift(),added=[];state.order.push(u);
      for(const {id:v} of adj[u]){state.checks++;if(state.dist[v]!==null)continue;state.dist[v]=state.dist[u]+1;state.parent[v]=u;state.frontier.push(v);added.push(v);}
      emit('visit',`Обрабатываем вершину ${u}`,added.length?`Берём ${u} из начала очереди. Добавляем новых соседей: ${added.join(', ')}.`:'Все соседи уже открыты. Ничего не добавляем.',{current:u,active:added.map(v=>key(u,v,graph.directed)),code:[4,5,6,7,8]});state.done.push(u);
    }
  }
  if(algorithm==='path'||algorithm==='dijkstra'){
    if(state.dist[target]!==null){let v=target;while(v!==undefined){state.path.unshift(v);v=state.parent[v];}}
    emit('done',state.path.length?'Кратчайший путь найден':'Цель недостижима',state.path.length?`${state.path.join(' → ')}. ${algorithm==='path'?'Число переходов':'Сумма весов'}: ${state.dist[target]}.`:`Из ${start} нельзя добраться до ${target} по разрешённым рёбрам.`,{current:null,code:[]});
  }else if(algorithm==='bfs')emit('done','Обход в ширину завершён',`Порядок: ${state.order.join(' → ')}. Обработано ${state.done.length} из ${graph.nodes.length} вершин.`,{current:null,code:[]});
  return steps;
}
export function checkPath(graph,path,start,target,weighted=false){
  if(!Array.isArray(path)||path[0]!==start||path.at(-1)!==target)return {ok:false,message:'Путь должен начинаться в старте и заканчиваться в цели.'};
  const adj=adjacency(graph);let cost=0;
  for(let i=1;i<path.length;i++){const e=adj[path[i-1]]?.find(e=>e.id===path[i]);if(!e)return {ok:false,message:`Нет допустимого перехода ${path[i-1]} → ${path[i]}.`};cost+=weighted?e.w:1;}
  const best=trace(graph,weighted?'dijkstra':'path',start,target).at(-1).dist[target];
  return {ok:cost===best,message:cost===best?`Верно. Длина ${cost} минимальна; допускаются разные оптимальные маршруты.`:`Ваш путь имеет длину ${cost}. Есть путь короче — попробуйте ещё раз.`};
}
export const PSEUDO={bfs:['queue = deque([start])','visited = {start}','while queue:','    u = queue.popleft()','    for v in sorted(graph[u]):','        if v not in visited:','            visited.add(v)','            queue.append(v)'],dfs:['def dfs(u):','    visited.add(u)','    order.append(u)','    # вызов находится в стеке','    for v in sorted(graph[u]):','        if v not in visited:','            dfs(v)','    # возврат к предыдущему вызову'],dijkstra:['dist[start] = 0','while есть открытые вершины:','    u = вершина с минимальным dist','    for v, weight in graph[u]:','        candidate = dist[u] + weight','        обновить, если candidate меньше','    отметить u обработанной']};
