import * as fs from "node:fs/promises";
const root = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-20";
const evidence = process.argv[2] ?? "measure-draft-03";
const out = `${root}/${evidence}/review`;
const report = JSON.parse(await fs.readFile(`${root}/${evidence}/measurements.json`, "utf8"));
await fs.mkdir(out, { recursive: true });
const files = report.screenshots.map((shot, index) => ({ ...shot, index }));
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/review") return new Response("<!doctype html><meta charset=utf-8><title>HIG20 evidence review</title>", {headers: {"content-type":"text/html"}});
    const index = Number(path.slice(1));
    if (!Number.isInteger(index) || !files[index]) return new Response("Not found", {status:404});
    return new Response(Bun.file(`${root}/${evidence}/${files[index].file}`));
  },
});
const view = new Bun.WebView({width:1500,height:1100,backend:"chrome"});
const pages = [];
try {
  await view.navigate(`http://127.0.0.1:${server.port}/review`);
  await view.cdp("Emulation.setDeviceMetricsOverride", {width:1500,height:1100,deviceScaleFactor:1,mobile:false});
  for (const kind of ["frames","dialogs"]) {
    const count = kind === "frames" ? 6 : 12;
    for (let start=0;start<files.length;start+=count) {
      const items = files.slice(start,start+count).map(item => {
        const parts = item.file.split("/");
        const row = report.rows.find(row => row.kind === "computed" &&
          (row.state === "archive" ? "archive" : row.legacy ? "legacy" : "current") === parts[0] &&
          `${row.width}x${row.height}` === parts[1] && row.theme === parts[2] &&
          `${row.scale}-${row.state}.png` === parts[3]);
        return {...item,crop:kind==="dialogs"?row?.result.modal:null};
      });
      await view.evaluate(`(async()=>{
        document.body.innerHTML="";
        document.body.style.cssText="margin:0;padding:10px;display:grid;grid-template-columns:repeat(${kind==="frames"?2:3},1fr);gap:8px;background:#ddd;color:#111;font:12px monospace";
        for(const item of ${JSON.stringify(items)}){
          const box=document.createElement("figure");box.style.cssText="margin:0;background:white;overflow:hidden";
          const canvas=document.createElement("canvas");canvas.width=${kind==="frames"?728:482};canvas.height=${kind==="frames"?326:238};
          canvas.style.cssText="display:block;width:100%;object-fit:contain";const ctx=canvas.getContext("2d");
          ctx.fillStyle="#eee";ctx.fillRect(0,0,canvas.width,canvas.height);
          const image=new Image();image.src="http://127.0.0.1:${server.port}/"+item.index;await image.decode();
          const r=item.crop?{x:Math.max(0,item.crop.x-12),y:Math.max(0,item.crop.y-12),width:item.crop.width+24,height:item.crop.height+24}:{x:0,y:0,width:image.width,height:image.height};
          const s=Math.min(canvas.width/r.width,canvas.height/r.height);
          ctx.drawImage(image,r.x,r.y,r.width,r.height,(canvas.width-r.width*s)/2,(canvas.height-r.height*s)/2,r.width*s,r.height*s);
          box.append(canvas);const label=document.createElement("figcaption");label.textContent=item.file;label.style.cssText="padding:3px;word-break:break-all";box.append(label);document.body.append(box);
        }
      })()`);
      const name = `${kind}-${String(start/count+1).padStart(2,"0")}.png`;
      const bytes = await view.screenshot();
      await fs.writeFile(`${out}/${name}`,new Uint8Array(await bytes.arrayBuffer()));
      pages.push({file:name,items:items.map(item=>item.file)});
    }
  }
} finally { await view.close(); server.stop(true); }
await fs.writeFile(`${out}/index.json`,JSON.stringify({images:files.length,pages},null,2));
console.log(`REVIEW images=${files.length} sheets=${pages.length}`);
