#!/usr/bin/env python3
"""Verify every pet folder against the OpenPets contract. Exit 1 on failure."""
import json, os, re, sys, glob
from PIL import Image

FW, FH = 192, 208
ROW_FRAMES = [6, 8, 8, 4, 5, 8, 6, 6, 6]
NAMES = ["idle", "running-right", "running-left", "waving", "jumping",
         "failed", "waiting", "running", "review"]


def check(d):
    pid, errs = os.path.basename(d), []
    im = Image.open(f"{d}/spritesheet.webp").convert("RGBA")
    m = json.load(open(f"{d}/pet.json"))
    if im.size != (1536, 1872):
        errs.append(f"sheet {im.size} != (1536, 1872)")
    if m["id"] != pid or not re.match(r"^[a-z0-9][a-z0-9_-]{0,63}$", pid) or pid == "builtin":
        errs.append("id must match folder and ^[a-z0-9][a-z0-9_-]{0,63}$")
    if m["spritesheetPath"] != "spritesheet.webp":
        errs.append("spritesheetPath")
    if not m["displayName"].strip() or len(m["displayName"]) > 80:
        errs.append("displayName")
    if not m["description"].strip() or len(m["description"]) > 500:
        errs.append("description")
    for r, n in enumerate(ROW_FRAMES):
        fr = [im.crop((c * FW, r * FH, (c + 1) * FW, (r + 1) * FH)) for c in range(n)]
        if any(f.getbbox() is None for f in fr):
            errs.append(f"{NAMES[r]}: empty frame")
        if len({f.tobytes() for f in fr}) < 2:
            errs.append(f"{NAMES[r]}: no animation")
        for c in range(n, 8):
            if im.crop((c * FW, r * FH, (c + 1) * FW, (r + 1) * FH)).getbbox():
                errs.append(f"{NAMES[r]}: art in unused column {c}")
        for c in range(n):
            a = fr[c].split()[3].load()
            if any(a[0, y] for y in range(FH)) or any(a[FW - 1, y] for y in range(FH)):
                errs.append(f"{NAMES[r]}[{c}]: clipped at side edge")
    return pid, errs


if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    fail = False
    for d in sorted(glob.glob(os.path.join(root, "*"))):
        if not os.path.isdir(d) or not os.path.exists(os.path.join(d, "pet.json")):
            continue
        pid, errs = check(d)
        print(f"{pid:22s} {'OK' if not errs else 'FAIL: ' + '; '.join(errs)}")
        fail |= bool(errs)
    sys.exit(1 if fail else 0)
