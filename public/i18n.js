// Локализация только текстов приложения. Пользовательские значения подставляются
// ПОСЛЕ перевода шаблона; код, имена, ответы и комментарии не переводятся.
import ru from './locales/ru.js';
import kk from './locales/kk.js';

const ids=new Map(ru.map((message,id)=>[message,id]));
let locale='ru';
try{if(globalThis.localStorage?.getItem('graph-language')==='kk')locale='kk';}catch{}
export const getLocale=()=>locale;
export function setLocale(value){
  locale=value==='kk'?'kk':'ru';
  try{globalThis.localStorage?.setItem('graph-language',locale);}catch{}
}
const escapeRegex=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const token=/⟦(\d+)⟧/g;
export function t(source,language=locale){
  if(language!=='kk'||typeof source!=='string')return source;
  const trimmed=source.trim(),id=ids.get(trimmed),translated=kk[id];
  return translated===undefined?source:source.slice(0,source.indexOf(trimmed))+translated+source.slice(source.indexOf(trimmed)+trimmed.length);
}
function interpolate(source,values){return source.replace(token,(_,i)=>String(values[Number(i)]??''));}
const template=(parts)=>parts.map((s,i)=>s+(i<parts.length-1?`⟦${i}⟧`:'')).join('');
export function tx(parts,...values){return interpolate(t(template(parts)),values);}

// Локализуем только статические текстовые узлы/подписи HTML-шаблона.
// Сначала обрабатываем шаблон, затем вставляем уже экранированные динамические значения.
export function translateMarkup(source,language=locale){
  if(language!=='kk')return source;
  return source.replace(/\b(aria-label|placeholder|title|alt|content)="([^"]+)"/g,(_,attr,value)=>`${attr}="${t(value,language)}"`)
    .replace(/(^|>)([^<]+)(?=<|$)/g,(_,prefix,value)=>prefix+t(value,language));
}
export function hx(parts,...values){return interpolate(translateMarkup(template(parts)),values);}
export function hm(source){return translateMarkup(source);}

// Только для доверенных материалов курса, никогда для ответа API с данными ученика.
export function translateContent(value,language=locale){
  if(typeof value==='string')return t(value,language);
  if(Array.isArray(value))return value.map(item=>translateContent(item,language));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,translateContent(v,language)]));
  return value;
}
const patterns=ru.flatMap((source,id)=>{
  if(!source.includes('⟦')||source.includes('<'))return [];
  const indices=[],parts=source.split(/(⟦\d+⟧)/);
  const expression=parts.map(part=>{const m=part.match(/^⟦(\d+)⟧$/);if(!m)return escapeRegex(part);indices.push(Number(m[1]));return '([\\s\\S]+?)';}).join('');
  return [{id,indices,regex:new RegExp('^'+expression+'$')}];
});
export function tRuntime(source,language=locale){
  if(language!=='kk'||typeof source!=='string')return source;
  if(ids.has(source.trim()))return t(source,language);
  for(const {id,indices,regex} of patterns){
    const match=source.trim().match(regex);if(!match)continue;
    const values={};indices.forEach((index,i)=>values[index]=match[i+1]);
    return interpolate(kk[id]??ru[id],values);
  }
  // Составные сообщения чистой модели: арифметика + пояснение обновления.
  const sentences=source.split(/(?<=\.)\s+(?=[А-ЯЁ])/);
  if(sentences.length>1)return sentences.map(s=>tRuntime(s,language)).join(' ');
  for(const label of ['Число переходов','Сумма весов'])if(source.startsWith(label+': '))return t(label,language)+source.slice(label.length);
  return source;
}

const originals=new WeakMap();
export function translateShell(){
  document.documentElement.lang=locale;
  for(const selector of ['.sidebar','.page-footer','.skip']){
    const root=document.querySelector(selector);if(!root)continue;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode;
      if(!originals.has(node))originals.set(node,node.nodeValue);
      node.nodeValue=t(originals.get(node));
    }
  }
  for(const [selector,attribute] of [['nav','aria-label'],['#close-dialog','aria-label'],['#python-frame','title'],['meta[name=description]','content']]){
    const el=document.querySelector(selector);if(!el)continue;
    if(!originals.has(el))originals.set(el,el.getAttribute(attribute));
    el.setAttribute(attribute,t(originals.get(el)));
  }
  const select=document.getElementById('language-select');
  if(select){select.value=locale;select.setAttribute('aria-label',t('Язык интерфейса'));}
}
