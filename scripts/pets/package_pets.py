#!/usr/bin/env python3
import os, json, zipfile, shutil
from PIL import Image, ImageDraw
from petgen import PETS, build_sheet, ORDER, ROW_FRAMES

OUT = "/home/claude/out"
FW, FH = 192, 208

# duration per state from reaction-animation-mapping.ts (durationMs / frames)
DUR = {"idle": 5500, "running-right": 1060, "running-left": 1060, "waving": 700,
       "jumping": 840, "failed": 1220, "waiting": 1010, "running": 820, "review": 1030}

BG = (24, 27, 34, 255)


def flatten(fr, bg=BG, scale=1):
    im = fr.resize((fr.width * scale, fr.height * scale), Image.NEAREST) if scale > 1 else fr
    c = Image.new("RGBA", im.size, bg)
    c.alpha_composite(im)
    return c.convert("RGB")


def main():
    for spec in PETS:
        pid = spec["id"]
        d = os.path.join(OUT, pid)
        sheet, F = build_sheet(spec["pal"], spec["kind"], spec.get("props"))
        prev = os.path.join(d, "preview")
        os.makedirs(prev, exist_ok=True)

        # per-state GIFs
        for state in ORDER:
            frames = [flatten(f, scale=2) for f in F[state]]
            frames[0].save(os.path.join(prev, f"{state}.gif"), save_all=True,
                           append_images=frames[1:], loop=0,
                           duration=max(60, DUR[state] // len(frames)), disposal=2)

        # combined showcase gif: idle -> review -> running -> jumping
        combo = []
        for state, reps in (("idle", 2), ("review", 2), ("running", 2), ("waving", 2), ("jumping", 2)):
            for _ in range(reps):
                combo += [flatten(f, scale=2) for f in F[state]]
        combo[0].save(os.path.join(prev, "showcase.gif"), save_all=True,
                      append_images=combo[1:], loop=0, duration=140, disposal=2)

        # static state sheet for docs
        states = [("idle", 0), ("review", 2), ("running", 0), ("waiting", 1),
                  ("waving", 0), ("jumping", 2), ("failed", 6)]
        card = Image.new("RGBA", (FW * len(states), FH + 34), (18, 20, 26, 255))
        dr = ImageDraw.Draw(card)
        for i, (st, fi) in enumerate(states):
            card.alpha_composite(F[st][fi].resize((FW, FH), Image.NEAREST), (i * FW, 0))
            dr.text((i * FW + 12, FH + 10), st, fill=(190, 198, 214))
        card.save(os.path.join(d, "states.png"))

        # zip for `openpets install --from-zip`
        zpath = os.path.join(OUT, f"{pid}.zip")
        with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(os.path.join(d, "pet.json"), "pet.json")
            z.write(os.path.join(d, "spritesheet.webp"), "spritesheet.webp")
        print(pid, "zip", os.path.getsize(zpath))

    # banner with all three pets
    cols, rows = 4, 2
    cw, ch = 300, 300
    W, Hh = cols * cw, rows * ch + 60
    banner = Image.new("RGBA", (W, Hh), (16, 18, 24, 255))
    dr = ImageDraw.Draw(banner)
    for y in range(Hh):
        t = y / Hh
        dr.line([(0, y), (W, y)], fill=(16 + int(10 * t), 18 + int(12 * t), 24 + int(20 * t)))
    for i, spec in enumerate(PETS):
        _, F = build_sheet(spec["pal"], spec["kind"], spec.get("props"))
        f = F["idle"][0].resize((int(FW * 0.95), int(FH * 0.95)), Image.NEAREST)
        cx = (i % cols) * cw + (cw - f.width) // 2
        cy = (i // cols) * ch + 66
        banner.alpha_composite(f, (cx, cy))
        tw = dr.textlength(spec["displayName"])
        dr.text(((i % cols) * cw + (cw - tw) / 2, cy + f.height + 8),
                spec["displayName"], fill=(214, 220, 234))
    dr.text((28, 22), "event4u pet pack  —  agent-switch · agent-config · event4u", fill=(140, 200, 220))
    banner.save(os.path.join(OUT, "banner.png"))
    print("banner ok")


if __name__ == "__main__":
    main()
