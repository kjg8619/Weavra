"""Generate exhaustive paired and hotspot contact sheets from runner outputs."""

import json
from pathlib import Path
from typing import Final

from PIL import Image, ImageDraw

ROOT: Final = Path("/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-21")
with (ROOT / "diff/pairs.json").open() as stream:
    pairs = json.load(stream)["pairs"]
review = ROOT / "review"
review.mkdir()
index = {"pairs": [], "hotspots": [], "cycles": []}
hotspots = []
for pair in pairs:
    hotspots.extend((pair, spot) for spot in pair["result"]["hotspots"])

for start in range(0, len(pairs), 8):
    sheet = Image.new("RGB", (1600, 1520), "#dddddd")
    draw = ImageDraw.Draw(sheet)
    selected = pairs[start:start + 8]
    for offset, pair in enumerate(selected):
        x, y = (offset % 2) * 800, (offset // 2) * 380
        draw.text((x + 4, y + 3), f'{start + offset + 1}: {pair["file"]}', fill="black")
        for side_index, side in enumerate(("before", "after")):
            with Image.open(ROOT / side / "capture" / pair["file"]) as original:
                frame = original.convert("RGB")
            frame.thumbnail((395, 350))
            sheet.paste(frame, (x + side_index * 400, y + 25))
    name = f"pairs-{start // 8 + 1:02}.png"
    sheet.save(review / name)
    index["pairs"].append({"sheet": name, "files": [pair["file"] for pair in selected]})

for start in range(0, len(hotspots), 18):
    sheet = Image.new("RGB", (1500, 1140), "#dddddd")
    draw = ImageDraw.Draw(sheet)
    selected = hotspots[start:start + 18]
    rows = []
    for offset, (pair, spot) in enumerate(selected):
        x, y = (offset % 3) * 500, (offset // 3) * 190
        draw.text((x + 2, y + 2), pair["file"][:65], fill="black")
        draw.text((x + 2, y + 17), f'x={spot["x"]}, y={spot["y"]}', fill="black")
        box = (spot["x"], spot["y"], spot["x"] + spot["width"], spot["y"] + spot["height"])
        for side_index, side in enumerate(("before", "after")):
            with Image.open(ROOT / side / "capture" / pair["file"]) as original:
                frame = original.crop(box).convert("RGB")
            frame.thumbnail((245, 150))
            sheet.paste(frame, (x + side_index * 250, y + 35))
        rows.append({"file": pair["file"], "box": list(box)})
    name = f"hotspots-{start // 18 + 1:02}.png"
    sheet.save(review / name)
    index["hotspots"].append({"sheet": name, "regions": rows})

with (ROOT / "qa/scenario-receipt.json").open() as stream:
    receipt = json.load(stream)
run = Path(receipt["capture"]["file"]).parent
cycle_head = ROOT / "qa" / run / "scenarios/21/theme-content-parity"
cycle_parent = ROOT / "diagnosis-parent/lead/run-a1ef8eb7-1966-443e-a8d2-898ac216e64a/scenarios/21/theme-content-parity"
cycle_files = sorted(cycle_head.glob("code-*.png"))
for start in range(0, len(cycle_files), 4):
    sheet = Image.new("RGB", (1600, 1600), "#dddddd")
    draw = ImageDraw.Draw(sheet)
    selected = cycle_files[start:start + 4]
    for offset, file in enumerate(selected):
        draw.text((4, offset * 400 + 2), file.name, fill="black")
        for side_index, directory in enumerate((cycle_parent, cycle_head)):
            with Image.open(directory / file.name) as original:
                frame = original.convert("RGB")
            frame.thumbnail((795, 370))
            sheet.paste(frame, (side_index * 800, offset * 400 + 25))
    name = f"cycles-{start // 4 + 1:02}.png"
    sheet.save(review / name)
    index["cycles"].append({"sheet": name, "files": [file.name for file in selected]})
with (review / "index.json").open("w") as stream:
    json.dump(index, stream, indent=2)
print(f'REVIEW_GENERATED pairs={len(pairs)} hotspots={len(hotspots)} cycles={len(cycle_files)}')
