import {t} from './i18n.js';
import {validateGraph} from './core.js';

// Формат переносимого примера не содержит аккаунтов, результатов или кода ученика.
function normalize(graph) {
  if(!graph||typeof graph.directed!=='boolean'||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges))throw Error(t('В файле нет корректного учебного графа.'));
  const clean={directed:graph.directed,
    nodes:graph.nodes.map(n=>({id:n?.id,x:n?.x,y:n?.y})),
    edges:graph.edges.map(e=>({a:e?.a,b:e?.b,w:e?.w}))};
  return validateGraph(clean);
}
export function graphFile(graph) {
  return {format:'graph-classroom',version:1,graph:normalize(graph)};
}
export function parseGraphFile(text) {
  if(typeof text!=='string'||text.length>32768)throw Error(t('Файл графа должен быть меньше 32 КБ.'));
  let value;try{value=JSON.parse(text);}catch{throw Error(t('Не удалось прочитать JSON. Выберите файл, скачанный из редактора графа.'));}
  if(value?.format!=='graph-classroom'||value?.version!==1)throw Error(t('Неподдерживаемый формат. Нужен JSON графа из этой платформы.'));
  return normalize(value.graph);
}
