// Геометрия отображения. Не знает об обходах, весах и DOM.
// Алгоритмы получают исходный graph из core.js; эти XYZ живут отдельно.
export const INITIAL_CAMERA = Object.freeze({yaw:0.35,pitch:-0.22,zoom:0.9});
export const clamp = (n,min,max) => Math.max(min,Math.min(max,n));

export function spatialLayout(nodes) {
  // Разносим ряды по глубине. Номера вершин, связи и веса рёбер не меняются.
  return Object.fromEntries(nodes.map((n,i)=>[n.id,{
    x:(n.x-360)*0.72,
    y:(n.y-180)*0.88,
    z:Math.sin(i*2.4)*95
  }]));
}
export function rotate(p,camera) {
  const cy=Math.cos(camera.yaw),sy=Math.sin(camera.yaw);
  const cp=Math.cos(camera.pitch),sp=Math.sin(camera.pitch);
  const x=p.x*cy+p.z*sy,z=-p.x*sy+p.z*cy;
  return {x,y:p.y*cp-z*sp,z:p.y*sp+z*cp};
}
export function unrotate(p,camera) {
  const cp=Math.cos(camera.pitch),sp=Math.sin(camera.pitch);
  const cy=Math.cos(camera.yaw),sy=Math.sin(camera.yaw);
  const y=p.y*cp+p.z*sp,z=-p.y*sp+p.z*cp;
  return {x:p.x*cy-z*sy,y,z:p.x*sy+z*cy};
}
export function project(p,camera) {
  const q=rotate(p,camera),scale=640/(640-q.z)*camera.zoom;
  return {x:360+q.x*scale,y:195+q.y*scale,z:q.z,scale};
}
export function unproject(x,y,depth,camera) {
  const scale=640/(640-depth)*camera.zoom;
  return unrotate({x:(x-360)/scale,y:(y-195)/scale,z:depth},camera);
}
