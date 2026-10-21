import {readdir,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'public'),output=path.join(root,'.pages-site');
// Only the generated directory inside this project may be cleaned recursively.
if(path.dirname(path.resolve(output))!==root||path.basename(output)!=='.pages-site')throw Error('Unsafe build output');
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
async function copyPublic(relative=''){
  for(const entry of await readdir(path.join(source,relative),{withFileTypes:true})){
    if(entry.name.startsWith('.'))continue;
    const name=path.join(relative,entry.name),destination=path.join(output,name);
    if(entry.isDirectory()){await mkdir(destination,{recursive:true});await copyPublic(name);}
    else if(entry.isFile()&&/\.(html|js|css|svg)$/.test(entry.name)&&!['runner.js','runner.html'].includes(entry.name)){
      let text=await readFile(path.join(source,name),'utf8');
      if(name==='index.html')text=text.replace(/(href|src)="\/(?!\/)/g,'$1="./');
      await writeFile(destination,text);
    }
  }
}
await copyPublic();
await writeFile(path.join(output,'site-config.js'),'export const staticDemo=true;\n');
await writeFile(path.join(output,'.nojekyll'),'');
console.log('Static demo built in .pages-site (no API, accounts, database or CNAME).');
