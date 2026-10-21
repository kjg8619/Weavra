import * as fs from "node:fs/promises";
const root="/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-19";
const out=`${root}/review`;
await fs.mkdir(out);
const json=async file=>JSON.parse(await fs.readFile(`${root}/${file}`,"utf8"));
const files=[];
async function scan(dir){
  for(const e of await fs.readdir(`${root}/${dir}`,{withFileTypes:true})){
    const file=`${dir}/${e.name}`;
    if(e.isDirectory())await scan(file);
    else if(file.endsWith(".png"))files.push(file);
  }
}
for(const dir of ["before/capture","after/capture","measure-before","measure-after"])await scan(dir);
const frames=files.map((file,index)=>({file,label:file,index}));
const hotspots=[];
for(const pair of [...(await json("diff/pairs.json")).pairs,...(await json("supplemental/pairs.json")).pairs.map(p=>({...p,supplemental:true}))])
  for(const [index,region]of pair.result.hotspots.entries())
    for(const side of ["before","after"]){
      const file=pair.supplemental?`measure-${side}/${pair.file}`:`${side}/capture/${pair.file}`;
      const imageIndex=files.indexOf(file);
      if(imageIndex<0)throw new Error(`Unbound image ${file}`);
      hotspots.push({file,index:imageIndex,region,label:`${file} hotspot ${index+1}`});
    }
const server=Bun.serve({
  hostname:"127.0.0.1",port:0,
  fetch(request){
    const url=new URL(request.url);
    if(url.pathname==="/review")return new Response("<!doctype html><meta charset=utf-8><title>HIG19 artifact review</title>",{headers:{"content-type":"text/html"}});
    const index=Number(url.pathname.slice(1));
    if(!Number.isInteger(index)||index<0||index>=files.length)return new Response("not found",{status:404});
    return new Response(Bun.file(`${root}/${files[index]}`),{headers:{"content-type":"image/png"}});
  },
});
const view=new Bun.WebView({width:1600,height:1000,backend:"chrome"});
const pages=[];
try{
  await view.navigate(`http://127.0.0.1:${server.port}/review`);
  await view.cdp("Emulation.setDeviceMetricsOverride",{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
  for(const [kind,items]of [["frames",frames],["hotspots",hotspots]]){
    for(let start=0;start<items.length;start+=64){
      const page=items.slice(start,start+64);
      await view.evaluate(`(async()=>{document.body.innerHTML="";document.body.style.cssText="margin:0;padding:8px;display:grid;grid-template-columns:repeat(8,1fr);gap:4px;background:#ddd;color:#111;font:8px monospace";const items=${JSON.stringify(page)};for(const item of items){const box=document.createElement('figure');box.style.cssText='margin:0;height:118px;overflow:hidden;background:white';const canvas=document.createElement('canvas');canvas.width=188;canvas.height=92;canvas.style.cssText='display:block;width:100%;height:92px;object-fit:contain';const context=canvas.getContext('2d');context.fillStyle='#eee';context.fillRect(0,0,188,92);const image=new Image();image.src='http://127.0.0.1:${server.port}/'+item.index;await image.decode();const r=item.region;const sw=r?r.width:image.width,sh=r?r.height:image.height;const scale=Math.min(188/sw,92/sh);context.drawImage(image,r?r.x:0,r?r.y:0,sw,sh,(188-sw*scale)/2,(92-sh*scale)/2,sw*scale,sh*scale);box.append(canvas);const label=document.createElement('figcaption');label.textContent=item.label;label.style.cssText='padding:2px;overflow-wrap:anywhere';box.append(label);document.body.append(box);}await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
      const name=`${kind}-${String(start/64+1).padStart(3,"0")}.png`;
      const bytes=await view.screenshot();
      await fs.writeFile(`${out}/${name}`,new Uint8Array(await bytes.arrayBuffer()));
      pages.push({file:name,items:page.map(p=>p.label)});
    }
  }
}finally{await view.close();server.stop(true);}
await fs.writeFile(`${out}/index.json`,JSON.stringify({frames:frames.length,hotspots:hotspots.length,pages},null,2));
console.log(`REVIEW_SHEETS frames=${frames.length} hotspots=${hotspots.length} pages=${pages.length}`);
