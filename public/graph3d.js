import {t,hx} from './i18n.js';
// SVG-рендерер настоящих XYZ-координат с перспективной проекцией.
// Получает готовый снимок шага. Никогда не запускает и не меняет алгоритм.
import {INITIAL_CAMERA,clamp,spatialLayout,project,unproject} from './spatial.js';
import {key} from './core.js';

export class Graph3D {
  constructor(host,graph,onSelect) {
    this.host=host;this.graph=graph;this.onSelect=onSelect;
    this.camera={...INITIAL_CAMERA};this.positions=spatialLayout(graph.nodes);
    this.interaction='rotate';this.raf=0;this.drag=null;
    this.abort=new AbortController();
    host.innerHTML=hx`<svg class="graph-svg spatial-svg" viewBox="0 0 720 390" tabindex="0" role="group" aria-label="Граф в 3D. Стрелки поворачивают, плюс и минус меняют масштаб, Home возвращает камеру."><defs><marker id="spatial-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L0 6 L6 3Z" fill="#6989a2"/></marker></defs><g class="spatial-scene"></g><g class="spatial-axis" aria-hidden="true"></g></svg>`;
    this.svg=host.querySelector('svg');this.scene=host.querySelector('.spatial-scene');
    const listen=(type,fn,options={})=>this.svg.addEventListener(type,fn,{...options,signal:this.abort.signal});
    listen('pointerdown',e=>this.pointerDown(e));
    listen('pointermove',e=>this.pointerMove(e));
    listen('pointerup',()=>this.pointerUp(true));
    listen('pointercancel',()=>this.pointerUp());
    listen('lostpointercapture',()=>this.pointerUp());
    listen('wheel',e=>{e.preventDefault();this.zoom(e.deltaY>0?-0.08:0.08);},{passive:false});
    listen('keydown',e=>this.keyboard(e));
  }
  update(step,mode,start,target,selected) {
    this.state={step,mode,start,target,selected};this.draw();
  }
  setInteraction(mode) {
    this.interaction=mode;this.svg.dataset.interaction=mode;
  }
  zoom(delta) {this.camera.zoom=clamp(this.camera.zoom+delta,0.55,1.45);this.schedule();}
  reset(layout=false) {
    this.camera={...INITIAL_CAMERA};if(layout)this.positions=spatialLayout(this.graph.nodes);
    this.schedule();
  }
  point(event) {
    const p=new DOMPoint(event.clientX,event.clientY);
    return p.matrixTransform(this.svg.getScreenCTM().inverse());
  }
  pointerDown(e) {
    if(e.button!==0||this.drag)return;
    const p=this.point(e),node=e.target.closest('[data-spatial-node]');
    const id=node?Number(node.dataset.spatialNode):null;
    this.drag={pressed:id,id:this.interaction==='move'?id:null,initial:p,last:p,moved:false,
      depth:id===null?0:project(this.positions[id],this.camera).z};
    this.svg.setPointerCapture(e.pointerId);
  }
  pointerMove(e) {
    if(!this.drag)return;
    const p=this.point(e),d=this.drag;
    if(Math.hypot(p.x-d.initial.x,p.y-d.initial.y)>4)d.moved=true;
    if(!d.moved)return;
    if(d.id!==null){
      // Движение в плоскости экрана; после поворота можно изменить любую XYZ ось.
      const q=unproject(p.x,p.y,d.depth,this.camera);
      const radius=Math.hypot(q.x,q.y,q.z),factor=Math.min(1,270/Math.max(radius,1));
      this.positions[d.id]={x:q.x*factor,y:q.y*factor,z:q.z*factor};
    }else{
      this.camera.yaw+=(p.x-d.last.x)*0.008;
      this.camera.pitch=clamp(this.camera.pitch+(p.y-d.last.y)*0.008,-1.45,1.45);
    }
    d.last=p;this.schedule();
  }
  pointerUp(select=false) {
    const clicked=select&&this.drag&&!this.drag.moved?this.drag.pressed:null;
    this.drag=null;
    if(clicked!==null)this.onSelect(clicked);
  }
  keyboard(e) {
    const node=e.target.closest('[data-spatial-node]');
    if(node&&['Enter',' '].includes(e.key)){e.preventDefault();this.onSelect(Number(node.dataset.spatialNode));return;}
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'].includes(e.key))return;
    e.preventDefault();
    if(e.key==='Home')this.reset();
    else if(e.key==='+'||e.key==='=')this.zoom(0.1);
    else if(e.key==='-')this.zoom(-0.1);
    else if(e.key==='ArrowLeft')this.camera.yaw-=0.12;
    else if(e.key==='ArrowRight')this.camera.yaw+=0.12;
    else this.camera.pitch=clamp(this.camera.pitch+(e.key==='ArrowUp'?-0.1:0.1),-1.45,1.45);
    this.schedule();
  }
  schedule() {if(!this.raf)this.raf=requestAnimationFrame(()=>{this.raf=0;this.draw();});}
  draw() {
    if(!this.state)return;
    const {step,mode,start,target,selected}=this.state;
    const pos=Object.fromEntries(this.graph.nodes.map(n=>[n.id,project(this.positions[n.id],this.camera)]));
    const paths=new Set((step.path||[]).slice(1).map((id,i)=>key(step.path[i],id,this.graph.directed)));
    const primitives=[];
    for(const e of this.graph.edges){
      const a=pos[e.a],b=pos[e.b],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
      if(len<12)continue;
      const k=key(e.a,e.b,this.graph.directed),cls=paths.has(k)?'path':step.active?.includes(k)?'active':'';
      const ar=23*clamp(a.scale,0.7,1.25),br=27*clamp(b.scale,0.7,1.25);
      const ratio=Math.min(0.45,ar/len),end=Math.min(0.45,br/len);
      primitives.push({z:(a.z+b.z)/2-0.01,html:`<g><line class="edge ${cls}" x1="${a.x+dx*ratio}" y1="${a.y+dy*ratio}" x2="${b.x-dx*end}" y2="${b.y-dy*end}"${this.graph.directed?' marker-end="url(#spatial-arrow)"':''}/>${['dijkstra','explore'].includes(mode)?`<circle class="weight-bg" cx="${(a.x+b.x)/2}" cy="${(a.y+b.y)/2}" r="13"/><text class="weight" x="${(a.x+b.x)/2}" y="${(a.y+b.y)/2}">${e.w}</text>`:''}</g>`});
    }
    for(const n of this.graph.nodes){
      const p=pos[n.id];
      const cls=mode==='explore'?(selected===n.id?'selected':''):step.path?.includes(n.id)?'path':step.current===n.id?'current':step.done?.includes(n.id)?'done':step.frontier?.includes(n.id)||step.stack?.includes(n.id)?'frontier':'';
      const meta=mode==='explore'?'':`${mode==='dfs'?t('гл.'):mode==='dijkstra'?'d':'ℓ'}=${step.dist[n.id]??'∞'}`;
      const status=({current:t('текущая'),done:t('завершена'),frontier:t('открыта'),path:t('итоговый путь'),selected:t('выбрана')})[cls]||t('не открыта');
      primitives.push({z:p.z,html:hx`<g class="node ${cls}" data-spatial-node="${n.id}" tabindex="0" role="button" aria-label="Вершина ${n.id}, ${status}. ${mode==='explore'?t('Показать связи'):t('Выбрать старт')}" transform="translate(${p.x} ${p.y})"><circle class="disc" r="${23*clamp(p.scale,0.7,1.25)}"/><text class="number">${n.id}</text><text class="node-meta" x="38" y="27">${meta}</text><text class="tag" y="-38">${mode!=='explore'&&n.id===start?t('СТАРТ'):mode!=='explore'&&['path','dijkstra'].includes(mode)&&n.id===target?t('ЦЕЛЬ'):''}</text></g>`});
    }
    // Painter's algorithm: дальние объекты рисуем первыми.
    const focused=document.activeElement?.dataset?.spatialNode;
    this.scene.innerHTML=primitives.sort((a,b)=>a.z-b.z).map(p=>p.html).join('');
    if(focused)this.scene.querySelector(`[data-spatial-node="${focused}"]`)?.focus({preventScroll:true});
    this.svg.querySelector('.spatial-axis').innerHTML=['x','y','z'].map((axis,i)=>{
      const p=project({x:axis==='x'?35:0,y:axis==='y'?-35:0,z:axis==='z'?35:0},{...this.camera,zoom:1});
      return `<line x1="42" y1="345" x2="${42+p.x-360}" y2="${345+p.y-195}" stroke="${['#bf4a57','#09876c','#427cc8'][i]}"/><text x="${42+(p.x-360)*1.25}" y="${345+(p.y-195)*1.25}">${axis.toUpperCase()}</text>`;
    }).join('');
  }
  dispose() {this.abort.abort();cancelAnimationFrame(this.raf);this.drag=null;}
}
