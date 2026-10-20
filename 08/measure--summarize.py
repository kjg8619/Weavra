import json,sys
M=sys.argv[1]
c=json.load(open(M+"composer.json"))["composer"];m=json.load(open(M+"model.json"))["model"];a=json.load(open(M+"address.json"))["address"];p=json.load(open(M+"palette.json"))["palette"]
r=lambda x:round(x,1)
tx=lambda o:[{"px":t["px"],"weight":t["weight"],"ratio":t["ratio"],"lines":t["lines"],"clipped":t["clipped"]} for t in o["texts"]]
out={"composer":{},"model":{},"address":{},"palette":{}}
for k,v in c["sizes"].items():
    h=v["help"][0];l=v["label"][0]
    out["composer"][k]={"help":{"w":r(h["w"]),"h":r(h["h"]),"text":tx(h),"hits":sum(1 for x in h["hits"] if x)},"label":tx(l),"overlap":[v["intersections"][x] for x in ("labelHelp","labelEditor","helpEditor")]}
for k,v in m["sizes"].items():
    out["model"][k]={"label":tx(v["label"][0]),"hint":tx(v["hint"][0]),"buttons":[{"t":b["text"],"w":r(b["w"]),"h":r(b["h"]),"text":tx(b),"hits":sum(1 for x in b["hits"] if x)} for b in v["btns"]],"input":[r(v["input"][0]["w"]),r(v["input"][0]["h"])],"pageOverflow":v["page"]}
def gaps(g,bs):
    ge=g["x"]+g["w"];gb=g["y"]+g["h"];res=[]
    for b in bs:
        bb=b["y"]+b["h"]
        if b["y"]<gb and bb>g["y"]:
            if b["x"]>=ge-0.5: res.append(("right",b["name"],r(b["x"]-ge)))
            elif b["x"]+b["w"]<=g["x"]+0.5: res.append(("left",b["name"],r(g["x"]-(b["x"]+b["w"]))))
        elif b["y"]>=gb-0.5 and b["x"]<ge and b["x"]+b["w"]>g["x"]: res.append(("below",b["name"],r(b["y"]-gb)))
        elif bb<=g["y"]+0.5 and b["x"]<ge and b["x"]+b["w"]>g["x"]: res.append(("above",b["name"],r(g["y"]-bb)))
    return res
for k,v in a["sizes"].items():
    i=v["input"][0];g=v["row"]["group"];bs=v["row"]["buttons"]
    gp=gaps(g,bs);rows=sorted(set(round(b["y"]) for b in bs))
    out["address"][k]={"inputW":r(i["w"]),"inputH":r(i["h"]),"urlOverflowX":i["overflowX"],"label":tx(v["label"][0]) if v["label"] else None,"group":[r(g["x"]),r(g["y"]),r(g["w"]),r(g["h"])],"adjacentGaps":gp,"minGap":min(x[2] for x in gp) if gp else None,"toolbarRows":rows}
def labs(o): return [{"text":l["text"],"px":l["texts"][0]["px"],"w":l["texts"][0]["weight"],"ratio":l["texts"][0]["ratio"],"lines":l["texts"][0]["lines"],"clipped":l["texts"][0]["clipped"]} for l in o] if o else None
out["palette"]={"search":labs(p.get("search",{}).get("labels")),"import":labs(p.get("importDialogLabels")),"folder":labs(p.get("folder",{}).get("labels")),"folderDark":labs(p.get("folderDark",{}).get("labels")),"repository":labs(p.get("repository",{}).get("labels")) if p.get("repository") else None,"confirm":labs(p.get("confirm",{}).get("labels")) if p.get("confirm") else None,"folderSizes":{k:labs(v["label"]) for k,v in p.get("folderSizes",{}).items()}}
json.dump(out,open(M+"f1-f4-summary.json","w"),indent=1)
print(json.dumps(out))
