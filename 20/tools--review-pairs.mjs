import * as fs from "node:fs/promises";
const root = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-20";
const pairs = JSON.parse(await fs.readFile(`${root}/diff/pairs.json`, "utf8")).pairs;
const out = `${root}/review`;
await fs.mkdir(out, { recursive: true });
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname);
    if (path === "/review") return new Response("<!doctype html><meta charset=utf-8>", { headers: { "content-type": "text/html" } });
    const [, side, id] = path.split("/");
    if (!["before", "after"].includes(side) || !pairs[Number(id)]) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(`${root}/${side}/capture/${pairs[Number(id)].file}`));
  },
});
const view = new Bun.WebView({ width: 1600, height: 1200, backend: "chrome" });
const sheets = [];
try {
  await view.navigate(`http://127.0.0.1:${server.port}/review`);
  await view.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false });
  for (let start = 0; start < pairs.length; start += 4) {
    const items = pairs.slice(start, start + 4).map((pair, offset) => ({ ...pair, index: start + offset }));
    await view.evaluate(`(async()=>{
      document.body.innerHTML="";document.body.style.cssText="margin:0;padding:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px;background:#ddd;color:#111;font:12px monospace";
      for(const pair of ${JSON.stringify(items)})for(const side of ["before","after"]){
        const box=document.createElement("figure");box.style.cssText="margin:0;background:#eee";
        const canvas=document.createElement("canvas");canvas.width=780;canvas.height=268;
        const image=new Image();image.src="http://127.0.0.1:${server.port}/"+side+"/"+pair.index;await image.decode();
        const ctx=canvas.getContext("2d"),scale=Math.min(canvas.width/image.width,canvas.height/image.height);
        ctx.fillStyle="#eee";ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(image,(canvas.width-image.width*scale)/2,(canvas.height-image.height*scale)/2,image.width*scale,image.height*scale);
        const caption=document.createElement("figcaption");caption.textContent=side+" "+pair.file+" diff="+pair.result.diffRatio;
        box.append(canvas,caption);document.body.append(box);
      }
    })()`);
    const name = `pairs-${String(start / 4 + 1).padStart(2, "0")}.png`, shot = await view.screenshot();
    await fs.writeFile(`${out}/${name}`, new Uint8Array(await shot.arrayBuffer()));
    sheets.push({ file: name, pairs: items.map(pair => pair.file) });
  }
} finally { await view.close(); server.stop(true); }
await fs.writeFile(`${out}/index.json`, JSON.stringify({ pairs: pairs.length, sheets }, null, 2));
console.log(`PAIR_REVIEW pairs=${pairs.length} sheets=${sheets.length}`);
