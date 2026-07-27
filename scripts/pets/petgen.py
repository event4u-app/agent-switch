#!/usr/bin/env python3
"""Generator for OpenPets-compatible pet spritesheets.

Layout contract (from openpets/apps/desktop/src/reaction-animation-mapping.ts):
  frame 192x208, 8 columns, 9 rows -> sheet 1536x1872, lossless WebP
  row 0 idle(6) 1 running-right(8) 2 running-left(8) 3 waving(4)
  row 4 jumping(5) 5 failed(8) 6 waiting(6) 7 running(6) 8 review(6)

Art is authored on a 48x52 logical pixel grid and scaled 4x (nearest).
"""
from PIL import Image, ImageDraw
import os, json, math

W, H = 48, 52          # logical pixel canvas
SCALE = 4              # -> 192 x 208
COLS, ROWS = 8, 9
FW, FH = W * SCALE, H * SCALE

ROW_FRAMES = [6, 8, 8, 4, 5, 8, 6, 6, 6]


# ---------------------------------------------------------------- primitives
def rect(d, x0, y0, x1, y1, c):
    if x1 < x0 or y1 < y0:
        return
    d.rectangle([x0, y0, x1, y1], fill=c)


def rrect(d, x0, y0, x1, y1, c, r=2):
    """Rectangle with r-sized corner notches (pixel-art rounding)."""
    if x1 < x0 or y1 < y0:
        return
    d.rectangle([x0, y0, x1, y1], fill=c)
    for i in range(r):
        cut = r - i
        for (px, py) in ((x0, y0 + i), (x1 - cut + 1, y0 + i),
                         (x0, y1 - i), (x1 - cut + 1, y1 - i)):
            d.rectangle([px, py, px + cut - 1, py], fill=(0, 0, 0, 0))


def orrect(d, x0, y0, x1, y1, fill, outline, r=2):
    """Outlined rounded rect: 1px dark border around the shape."""
    rrect(d, x0 - 1, y0 - 1, x1 + 1, y1 + 1, outline, r + 1)
    rrect(d, x0, y0, x1, y1, fill, r)


# ---------------------------------------------------------------- palettes
def palette(**kw):
    base = dict(
        ink=(22, 24, 30, 255),
        hat=(46, 50, 62, 255),
        hat_hi=(66, 71, 86, 255),
        band=(206, 162, 74, 255),
        head=(58, 63, 77, 255),
        head_hi=(78, 84, 101, 255),
        visor=(80, 214, 232, 255),
        visor_hi=(190, 248, 255, 255),
        coat=(38, 44, 60, 255),
        coat_hi=(54, 62, 82, 255),
        shirt=(228, 232, 240, 255),
        accent=(80, 214, 232, 255),
        skin=(214, 220, 232, 255),
        shoe=(26, 29, 38, 255),
        glass=(150, 220, 240, 160),
    )
    base.update(kw)
    return base


SPY = palette()

WARDEN = palette(
    hat=(120, 126, 138, 255),      # iron helmet
    hat_hi=(160, 167, 180, 255),
    band=(196, 132, 58, 255),      # bronze
    head=(60, 56, 66, 255),
    head_hi=(84, 79, 92, 255),
    visor=(246, 168, 62, 255),     # amber eye slit
    visor_hi=(255, 226, 170, 255),
    coat=(52, 44, 46, 255),        # leather/fur tunic
    coat_hi=(74, 62, 62, 255),
    shirt=(198, 186, 168, 255),
    accent=(246, 168, 62, 255),
    shoe=(38, 32, 32, 255),
)

SCOUT = palette(                    # third variant: field scout / recon
    hat=(52, 74, 62, 255),
    hat_hi=(74, 100, 84, 255),
    band=(180, 196, 120, 255),
    head=(50, 60, 58, 255),
    head_hi=(70, 82, 78, 255),
    visor=(168, 236, 130, 255),
    visor_hi=(226, 255, 200, 255),
    coat=(44, 58, 52, 255),
    coat_hi=(62, 80, 70, 255),
    shirt=(220, 226, 208, 255),
    accent=(168, 236, 130, 255),
    shoe=(28, 36, 32, 255),
)


RAVER = palette(                    # event4u festival visitor
    hat=(86, 52, 128, 255),
    hat_hi=(120, 78, 172, 255),
    band=(255, 106, 176, 255),
    head=(58, 48, 78, 255),
    head_hi=(82, 68, 106, 255),
    visor=(255, 106, 176, 255),
    visor_hi=(255, 214, 236, 255),
    coat=(48, 38, 70, 255),
    coat_hi=(70, 56, 100, 255),
    shirt=(236, 228, 246, 255),
    accent=(120, 236, 214, 255),
    shoe=(32, 26, 46, 255),
)

CREW = palette(                     # event4u stage crew / roadie
    hat=(44, 48, 54, 255),
    hat_hi=(66, 72, 80, 255),
    band=(244, 168, 40, 255),
    head=(54, 58, 64, 255),
    head_hi=(74, 80, 88, 255),
    visor=(244, 168, 40, 255),
    visor_hi=(255, 232, 178, 255),
    coat=(40, 44, 50, 255),
    coat_hi=(58, 64, 72, 255),
    shirt=(214, 222, 230, 255),
    accent=(244, 168, 40, 255),
    shoe=(28, 31, 36, 255),
)

BARD = palette(                     # event4u / horn_and_ash folk-metal bard
    hat=(96, 70, 44, 255),          # hair
    hat_hi=(126, 94, 60, 255),
    band=(196, 132, 58, 255),
    head=(62, 52, 50, 255),
    head_hi=(86, 72, 68, 255),
    visor=(226, 116, 62, 255),
    visor_hi=(255, 208, 168, 255),
    coat=(58, 40, 38, 255),
    coat_hi=(80, 56, 52, 255),
    shirt=(206, 190, 164, 255),
    accent=(226, 116, 62, 255),
    shoe=(38, 28, 26, 255),
)

DEVBOT = palette(                   # hoodie developer bot
    hat=(44, 50, 60, 255),
    hat_hi=(62, 70, 84, 255),
    band=(120, 240, 160, 255),
    head=(40, 46, 56, 255),
    head_hi=(58, 66, 80, 255),
    visor=(120, 240, 160, 255),
    visor_hi=(214, 255, 230, 255),
    coat=(52, 60, 74, 255),
    coat_hi=(72, 82, 100, 255),
    shirt=(226, 232, 242, 255),
    accent=(120, 240, 160, 255),
    shoe=(30, 34, 42, 255),
)

CEO = palette(                      # boardroom
    hat=(66, 58, 52, 255),          # hair
    hat_hi=(94, 84, 74, 255),
    band=(212, 176, 96, 255),
    head=(62, 62, 70, 255),
    head_hi=(86, 86, 96, 255),
    visor=(210, 220, 236, 255),     # glasses shine
    visor_hi=(255, 255, 255, 255),
    coat=(30, 34, 46, 255),
    coat_hi=(46, 52, 68, 255),
    shirt=(246, 248, 252, 255),
    accent=(196, 62, 74, 255),      # power tie red
    shoe=(22, 25, 34, 255),
)


# ---------------------------------------------------------------- body parts
def draw_legs(d, p, pose, dy=0):
    """pose: 'stand' | 'run_a' | 'run_b' | 'tuck' | 'crouch' | 'tap0/1' | 'slump'"""
    ink, coat, shoe = p["ink"], p["coat"], p["shoe"]
    y0 = 45 + dy

    def leg(x0, x1, top, bot, foot_dx=0):
        orrect(d, x0, top, x1, bot, coat, ink, r=1)
        rect(d, x0 - 1 + foot_dx, bot, x1 + 1 + foot_dx, bot + 1, shoe)
        rect(d, x0 - 2 + foot_dx, bot + 1, x1 + 1 + foot_dx, bot + 1, ink)

    if pose == "stand":
        leg(17, 22, y0, y0 + 4)
        leg(25, 30, y0, y0 + 4)
    elif pose == "run_a":
        leg(14, 19, y0, y0 + 3, -1)
        leg(27, 32, y0 + 1, y0 + 4, 1)
    elif pose == "run_b":
        leg(16, 21, y0 + 1, y0 + 4, -1)
        leg(25, 30, y0, y0 + 3, 1)
    elif pose == "tuck":
        leg(17, 22, y0 - 1, y0 + 1)
        leg(25, 30, y0 - 1, y0 + 1)
    elif pose == "crouch":
        leg(16, 22, y0 + 2, y0 + 4)
        leg(25, 31, y0 + 2, y0 + 4)
    elif pose == "tap0":
        leg(17, 22, y0, y0 + 4)
        leg(25, 30, y0, y0 + 4)
    elif pose == "tap1":
        leg(17, 22, y0, y0 + 4)
        leg(25, 30, y0, y0 + 2, 0)
        rect(d, 24, y0 + 3, 31, y0 + 4, p["shoe"])
    elif pose == "slump":
        leg(15, 21, y0 + 1, y0 + 4, -1)
        leg(26, 32, y0 + 1, y0 + 4, 1)


def draw_arm(d, p, side, pose, dy=0):
    """side: -1 left(viewer) / +1 right. pose: down|swing_f|swing_b|up|cross|point|hold"""
    ink, coat, skin = p["ink"], p["coat"], p["skin"]
    xc = 11 if side < 0 else 36
    y = 30 + dy

    def limb(x0, y0, x1, y1, hx, hy):
        orrect(d, x0, y0, x1, y1, coat, ink, r=1)
        orrect(d, hx, hy, hx + 3, hy + 3, skin, ink, r=1)

    if pose == "down":
        limb(xc - 2, y, xc + 2, y + 9, xc - 2, y + 10)
    elif pose == "swing_f":
        limb(xc - 2, y - 1, xc + 2, y + 6, xc - 1 + side, y + 6)
    elif pose == "swing_b":
        limb(xc - 2, y + 2, xc + 2, y + 10, xc - 3 - side, y + 10)
    elif pose == "up":
        limb(xc - 2, y - 8, xc + 2, y + 3, xc - 2, y - 12)
    elif pose == "cross":
        limb(xc - 2 - side * 3, y + 5, xc + 2 - side * 3, y + 8, xc - 2 - side * 6, y + 5)
    elif pose == "point":
        limb(xc - 2, y + 2, xc + 2, y + 6, xc - 1 + side * 3, y + 5)
    elif pose == "hold":
        limb(xc - 2, y - 2, xc + 2, y + 4, xc - 2 + side * 2, y - 5)


def draw_body(d, p, kind, dy=0, lean=0):
    ink = p["ink"]
    x0, x1 = 12 + lean, 35 + lean
    y0, y1 = 28 + dy, 45 + dy
    orrect(d, x0, y0, x1, y1, p["coat"], ink, r=3)
    # coat opening / shirt
    rect(d, x0 + 8, y0 + 1, x1 - 8, y1 - 3, p["shirt"])
    # lapels
    for i in range(4):
        rect(d, x0 + 6 + i, y0 + i, x0 + 8, y0 + i, p["coat_hi"])
        rect(d, x1 - 8, y0 + i, x1 - 6 - i, y0 + i, p["coat_hi"])
    # tie / strap
    rect(d, x0 + 11, y0 + 3, x0 + 12, y0 + 12, p["accent"])
    rect(d, x0 + 10, y0 + 2, x0 + 13, y0 + 3, p["accent"])
    # profile badge (the "switch" indicator)
    if kind in ("spy", "scout"):
        orrect(d, x0 + 2, y0 + 5, x0 + 5, y0 + 8, p["accent"], ink, r=1)
    if kind == "warden":
        # belt + rune plate
        rect(d, x0, y1 - 5, x1, y1 - 3, p["band"])
        rect(d, x0 + 9, y1 - 6, x0 + 14, y1 - 2, p["hat_hi"])
    if kind == "spy":
        rect(d, x0, y0 + 10, x0 + 2, y1, p["coat_hi"])   # coat flare
        rect(d, x1 - 2, y0 + 10, x1, y1, p["coat_hi"])
    if kind == "raver":                                   # lanyard + festival ticket
        for i in range(6):
            rect(d, x0 + 6 + i, y0 + i, x0 + 6 + i, y0 + i, p["accent"])
            rect(d, x1 - 6 - i, y0 + i, x1 - 6 - i, y0 + i, p["accent"])
        orrect(d, x0 + 9, y0 + 6, x0 + 14, y0 + 11, p["band"], ink, r=1)
        rect(d, x0 + 10, y0 + 8, x0 + 13, y0 + 8, p["shirt"])
    if kind == "crew":                                    # hi-vis reflective bands
        rect(d, x0, y0 + 6, x1, y0 + 7, p["band"])
        rect(d, x0, y0 + 11, x1, y0 + 12, p["band"])
        orrect(d, x0 + 2, y0 + 14, x0 + 6, y1 - 2, p["coat_hi"], ink, r=1)
    if kind == "bard":                                    # studded belt + strap
        rect(d, x0, y1 - 5, x1, y1 - 3, p["band"])
        for sx in range(x0 + 2, x1 - 1, 4):
            rect(d, sx, y1 - 5, sx + 1, y1 - 4, p["hat_hi"])
        for i in range(14):
            rect(d, x0 + 2 + i, y0 + 1 + i, x0 + 3 + i, y0 + 1 + i, p["coat_hi"])
    if kind == "dev":                                     # hoodie pocket + drawstrings
        orrect(d, x0 + 5, y1 - 8, x1 - 5, y1 - 3, p["coat_hi"], ink, r=2)
        rect(d, x0 + 9, y0, x0 + 10, y0 + 6, p["accent"])
        rect(d, x1 - 10, y0, x1 - 9, y0 + 6, p["accent"])
    if kind == "ceo":                                     # pocket square + buttons
        orrect(d, x0 + 2, y0 + 5, x0 + 6, y0 + 7, p["shirt"], ink, r=0)
        for by in (y0 + 9, y0 + 13):
            rect(d, x1 - 6, by, x1 - 5, by + 1, p["band"])


def draw_head(d, p, kind, dy=0, tilt=0, eyes="open", extra=None):
    ink = p["ink"]
    x0, x1 = 13 + tilt, 34 + tilt
    y0, y1 = 9 + dy, 27 + dy

    # backdrop layers that must sit *behind* the face
    if kind == "dev":
        orrect(d, x0 - 3, y0 - 5, x1 + 3, y1 + 1, p["coat_hi"], ink, r=4)
    elif kind == "bard":
        orrect(d, x0 - 3, y0 - 4, x1 + 3, y1 + 4, p["hat"], ink, r=4)
        rect(d, x0 - 3, y0 + 2, x0 - 1, y1 + 3, p["hat_hi"])
        rect(d, x1 + 1, y0 + 2, x1 + 3, y1 + 3, p["hat_hi"])
    elif kind == "raver":
        orrect(d, x0 - 4, y0 + 4, x0 - 1, y0 + 11, p["hat"], ink, r=1)   # ear cups
        orrect(d, x1 + 1, y0 + 4, x1 + 4, y0 + 11, p["hat"], ink, r=1)

    orrect(d, x0, y0, x1, y1, p["head"], ink, r=3)
    rect(d, x0 + 1, y0 + 1, x1 - 1, y0 + 2, p["head_hi"])

    # visor / eyes
    vx0, vx1 = x0 + 2, x1 - 2
    vy = y0 + 6
    if eyes == "blink":
        orrect(d, vx0, vy + 2, vx1, vy + 3, p["visor"], ink, r=0)
    elif eyes == "x":
        orrect(d, vx0, vy, vx1, vy + 4, (48, 52, 66, 255), ink, r=1)
        for i in range(4):
            rect(d, vx0 + 2 + i, vy + i, vx0 + 2 + i, vy + i, p["visor"])
            rect(d, vx0 + 5 - i, vy + i, vx0 + 5 - i, vy + i, p["visor"])
            rect(d, vx1 - 5 + i, vy + i, vx1 - 5 + i, vy + i, p["visor"])
            rect(d, vx1 - 2 - i, vy + i, vx1 - 2 - i, vy + i, p["visor"])
    elif eyes == "scan":
        orrect(d, vx0, vy, vx1, vy + 4, p["visor"], ink, r=1)
        rect(d, vx0 + 1, vy + 1, vx1 - 1, vy + 1, p["visor_hi"])
        for gx in range(vx0 + 1, vx1, 3):
            rect(d, gx, vy + 3, gx, vy + 3, (24, 30, 40, 180))
    elif eyes == "happy":
        orrect(d, vx0, vy, vx1, vy + 4, (48, 52, 66, 255), ink, r=1)
        for i in range(4):
            rect(d, vx0 + 2 + i, vy + 3 - min(i, 2), vx0 + 2 + i, vy + 3 - min(i, 2), p["visor_hi"])
            rect(d, vx1 - 2 - i, vy + 3 - min(i, 2), vx1 - 2 - i, vy + 3 - min(i, 2), p["visor_hi"])
    else:
        orrect(d, vx0, vy, vx1, vy + 4, p["visor"], ink, r=1)
        rect(d, vx0 + 1, vy + 1, vx1 - 3, vy + 1, p["visor_hi"])
        rect(d, vx1 - 4, vy + 2, vx1 - 1, vy + 3, (255, 255, 255, 110))

    # mouth hint
    rect(d, x0 + 9, y1 - 3, x1 - 9, y1 - 3, (26, 30, 40, 170))

    # headgear
    if kind == "spy":
        brim_y = y0 - 2
        orrect(d, x0 - 4, brim_y, x1 + 4, brim_y + 1, p["hat"], ink, r=2)
        orrect(d, x0 + 2, brim_y - 6, x1 - 2, brim_y - 1, p["hat"], ink, r=2)
        rect(d, x0 + 2, brim_y - 1, x1 - 2, brim_y - 1, p["band"])
        rect(d, x0 + 3, brim_y - 5, x1 - 8, brim_y - 5, p["hat_hi"])
    elif kind == "warden":
        top = y0 - 1
        orrect(d, x0 - 1, top - 6, x1 + 1, top + 3, p["hat"], ink, r=3)
        rect(d, x0 + 9, top - 6, x0 + 12, top + 8, p["hat_hi"])      # nose guard
        rect(d, x0 - 1, top + 2, x1 + 1, top + 3, p["band"])
        # horns
        for s, bx in ((-1, x0 - 2), (1, x1 + 2)):
            for i in range(4):
                rect(d, bx + s * i, top - 3 - i, bx + s * i + (1 if s > 0 else -1), top - 2 - i, p["band"])
    elif kind == "scout":
        top = y0 - 1
        orrect(d, x0 - 3, top - 1, x1 + 3, top + 1, p["hat"], ink, r=2)   # cap brim
        orrect(d, x0 + 1, top - 6, x1 - 1, top - 1, p["hat"], ink, r=2)
        rect(d, x0 + 2, top - 5, x1 - 6, top - 5, p["hat_hi"])
        rect(d, x0 + 8, top - 4, x0 + 13, top - 2, p["band"])

    elif kind == "raver":
        top = y0 - 1
        orrect(d, x0 + 1, top - 6, x1 - 1, top - 1, p["hat"], ink, r=2)      # cap crown
        orrect(d, x1 - 2, top - 5, x1 + 5, top - 3, p["hat_hi"], ink, r=1)   # brim worn backwards
        rect(d, x0 + 3, top - 6, x1 - 6, top - 6, p["hat_hi"])
        rect(d, x0 - 3, top - 7, x1 + 3, top - 6, p["band"])                 # headphone band
        rect(d, x0 - 4, y0 + 5, x0 - 2, y0 + 6, p["band"])
        rect(d, x1 + 2, y0 + 5, x1 + 4, y0 + 6, p["band"])
    elif kind == "crew":
        top = y0 - 1
        orrect(d, x0, top - 6, x1, top + 1, p["hat"], ink, r=3)              # beanie
        rect(d, x0, top, x1, top + 1, p["hat_hi"])
        rect(d, x0 + 9, top - 8, x0 + 12, top - 6, p["band"])                # pom
        orrect(d, x1 + 1, y0 + 5, x1 + 3, y0 + 10, p["hat"], ink, r=1)       # headset cup
        for i in range(5):                                                    # boom mic
            rect(d, x1 - i, y0 + 11 + i // 2, x1 - i, y0 + 11 + i // 2, p["hat_hi"])
        rect(d, x1 - 6, y0 + 13, x1 - 5, y0 + 14, p["band"])
    elif kind == "bard":
        rect(d, x0 - 2, y0 + 2, x1 + 2, y0 + 3, p["band"])                   # headband
        rect(d, x0 + 8, y0 + 1, x0 + 13, y0 + 2, p["hat_hi"])
    elif kind == "dev":
        rect(d, x0 - 2, y0 - 4, x1 + 2, y0 - 3, p["coat"])                   # hood rim
        rect(d, x0 - 3, y0 - 2, x0 - 1, y1 - 1, p["coat"])
        rect(d, x1 + 1, y0 - 2, x1 + 3, y1 - 1, p["coat"])
    elif kind == "ceo":
        orrect(d, x0, y0 - 3, x1, y0 + 2, p["hat"], ink, r=3)                # slick hair
        rect(d, x0 + 3, y0 - 3, x0 + 6, y0 - 1, p["hat_hi"])                 # side part
        rect(d, x1 + 1, y0 + 8, x1 + 2, y0 + 10, p["band"])                  # earpiece
        rect(d, x0 - 1, y0 + 6, x0 - 1, y0 + 10, p["visor_hi"])              # glasses arm
        rect(d, x1 + 1, y0 + 6, x1 + 1, y0 + 10, p["visor_hi"])

    if extra == "sweat":
        rect(d, x1 + 2, y0 + 3, x1 + 3, y0 + 6, (140, 210, 255, 220))
        rect(d, x1 + 1, y0 + 6, x1 + 4, y0 + 7, (140, 210, 255, 220))


def draw_magnifier(d, p, x, y):
    ink = p["ink"]
    orrect(d, x, y, x + 7, y + 7, p["glass"], ink, r=2)
    rect(d, x + 1, y + 1, x + 3, y + 2, (255, 255, 255, 130))
    for i in range(4):
        rect(d, x + 8 + i, y + 8 + i, x + 9 + i, y + 9 + i, p["band"])


def draw_console(d, p, x, y, blink):
    """Small floating terminal the pet types on."""
    ink = p["ink"]
    orrect(d, x, y, x + 15, y + 9, (20, 26, 36, 255), ink, r=2)
    rect(d, x + 1, y + 1, x + 14, y + 1, (44, 54, 70, 255))
    for i, ln in enumerate((10, 7, 12)):
        rect(d, x + 2, y + 3 + i * 2, x + 2 + ln, y + 3 + i * 2, p["accent"] if i == blink % 3 else (70, 84, 104, 255))


def draw_switch_glyph(d, p, x, y, on):
    """Profile-switch toggle: reads as the agent-switch product mark."""
    ink = p["ink"]
    orrect(d, x, y, x + 11, y + 5, (28, 34, 46, 255), ink, r=2)
    kx = x + 7 if on else x + 1
    rect(d, kx, y + 1, kx + 3, y + 4, p["accent"] if on else (110, 120, 140, 255))


def draw_scanner(d, p, x, y, i):
    """Ticket / wristband scanner with beam - event4u check-in."""
    ink = p["ink"]
    orrect(d, x, y, x + 7, y + 11, (26, 32, 44, 255), ink, r=2)
    rect(d, x + 1, y + 1, x + 6, y + 6, p["shirt"])
    for gx in range(x + 2, x + 6, 2):          # QR blocks
        for gy in range(y + 2, y + 6, 2):
            rect(d, gx, gy, gx, gy, ink)
    rect(d, x + 1, y + 8, x + 6, y + 9, p["accent"] if i % 2 == 0 else p["hat_hi"])
    for k in range(3):                          # beam
        rect(d, x - 2 - k, y + 3 - k, x - 2 - k, y + 3 + k, (255, 255, 255, 120 - k * 30))


def draw_clipboard(d, p, x, y, i):
    ink = p["ink"]
    orrect(d, x, y, x + 9, y + 12, (222, 214, 196, 255), ink, r=1)
    rect(d, x + 3, y - 1, x + 6, y + 1, p["hat_hi"])
    for k in range(4):
        w = (7, 5, 8, 4)[k]
        c = p["accent"] if k == i % 4 else (110, 106, 96, 255)
        rect(d, x + 1, y + 3 + k * 2, x + 1 + w, y + 3 + k * 2, c)


def draw_chart(d, p, x, y, i):
    """Bar chart panel - growth deck."""
    ink = p["ink"]
    orrect(d, x, y, x + 15, y + 11, (24, 28, 40, 255), ink, r=2)
    heights = [(2, 4, 6, 8), (3, 5, 7, 9), (4, 6, 8, 9), (2, 5, 7, 9),
               (3, 6, 8, 9), (4, 7, 9, 9)][i % 6]
    for k, h in enumerate(heights):
        bx = x + 2 + k * 3
        rect(d, bx, y + 10 - h, bx + 1, y + 10, p["accent"] if k == 3 else p["band"])
    for k in range(4):                          # trend arrow
        rect(d, x + 2 + k * 3, y + 8 - k * 2, x + 3 + k * 3, y + 8 - k * 2, p["visor_hi"])


def draw_mixer(d, p, x, y, i):
    """Mixing desk with moving faders - stage crew."""
    ink = p["ink"]
    orrect(d, x, y, x + 17, y + 9, (28, 30, 36, 255), ink, r=2)
    for k in range(5):
        fx = x + 2 + k * 3
        rect(d, fx, y + 2, fx, y + 7, (72, 78, 88, 255))
        fy = y + 2 + ((i + k) % 5)
        rect(d, fx - 1, fy, fx + 1, fy + 1, p["accent"] if (i + k) % 3 == 0 else p["band"])


def draw_glowstick(d, p, x, y):
    rect(d, x, y, x + 1, y + 9, p["visor_hi"])
    rect(d, x - 1, y + 1, x + 2, y + 8, (255, 255, 255, 90))
    rect(d, x, y - 1, x + 1, y - 1, p["accent"])


def draw_guitar(d, p, x, y):
    """Small flying-V style axe."""
    ink = p["ink"]
    orrect(d, x, y + 7, x + 9, y + 14, p["coat_hi"], ink, r=2)
    rect(d, x + 3, y + 9, x + 6, y + 12, ink)
    for k in range(8):                          # neck
        rect(d, x + 8 + k, y + 6 - k, x + 9 + k, y + 7 - k, p["hat"])
    rect(d, x + 15, y - 3, x + 18, y - 1, p["band"])


def draw_mug(d, p, x, y):
    ink = p["ink"]
    orrect(d, x, y + 4, x + 6, y + 10, p["shirt"], ink, r=1)
    rect(d, x + 1, y + 5, x + 5, y + 6, (96, 62, 40, 255))
    rect(d, x + 7, y + 6, x + 8, y + 8, ink)
    for k in range(3):                          # steam
        rect(d, x + 1 + k * 2, y - k, x + 1 + k * 2, y + 2 - k, (255, 255, 255, 90))


def spark(d, p, x, y, size):
    """Four-pointed spark (generic, non-branded)."""
    c = p["visor_hi"]
    for i in range(size):
        rect(d, x, y - i, x, y - i, c)
        rect(d, x, y + i, x, y + i, c)
        rect(d, x - i, y, x - i, y, c)
        rect(d, x + i, y, x + i, y, c)


# ---------------------------------------------------------------- frames
def new_frame():
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def compose(p, kind, *, dy=0, legs="stand", arm_l="down", arm_r="down",
            eyes="open", head_dy=0, lean=0, extra=None, tilt=0):
    img, d = new_frame()
    draw_arm(d, p, -1, arm_l, dy)          # back arm
    draw_legs(d, p, legs, dy)
    draw_body(d, p, kind, dy, lean)
    draw_arm(d, p, +1, arm_r, dy)          # front arm
    draw_head(d, p, kind, dy + head_dy, tilt, eyes, extra)
    return img, d


# (draw fn, dx, dy) - offsets keep wide props inside the 48x52 canvas
REVIEW_PROPS = {"magnifier": (lambda d, p, x, y, i: draw_magnifier(d, p, x, y), -4, 0),
                "scanner": (draw_scanner, -1, -2),
                "clipboard": (draw_clipboard, -5, 0),
                "chart": (draw_chart, -9, 2)}
WORK_PROPS = {"console": (draw_console, 0, 0), "mixer": (draw_mixer, -1, 0),
              "chart": (draw_chart, 0, 0)}
HAND_PROPS = {"none": None, "glowstick": (draw_glowstick, 5, -2),
              "guitar": (draw_guitar, -8, 2), "mug": (draw_mug, 0, 0)}


def build_frames(p, kind, props=None):
    props = props or {}
    review_prop = REVIEW_PROPS[props.get("review", "magnifier")]
    work_prop = WORK_PROPS[props.get("work", "console")]
    hand_prop = HAND_PROPS[props.get("hand", "none")]
    F = {}

    # --- row 0: idle (6) - breathing + occasional blink
    idle = []
    for i in range(6):
        dy = (0, 0, 1, 1, 0, 0)[i]
        eyes = "blink" if i == 4 else "open"
        img, d = compose(p, kind, dy=dy, eyes=eyes)
        idle.append(img)
    F["idle"] = idle

    # --- row 1: running-right (8)
    run = []
    for i in range(8):
        phase = i % 4
        dy = (0, -1, 0, 1)[phase]
        legs = "run_a" if i < 4 else "run_b"
        al = "swing_f" if i < 4 else "swing_b"
        ar = "swing_b" if i < 4 else "swing_f"
        img, d = compose(p, kind, dy=dy, legs=legs, arm_l=al, arm_r=ar, lean=1)
        # motion streaks behind
        for k in range(3):
            rect(d, 2 + k, 20 + k * 6 + dy, 6 + k * 2, 20 + k * 6 + dy, (255, 255, 255, 60))
        run.append(img)
    F["running-right"] = run
    F["running-left"] = [im.transpose(Image.FLIP_LEFT_RIGHT) for im in run]

    # --- row 3: waving (4)
    wave = []
    for i in range(4):
        tilt = (0, 1, 0, 1)[i]
        img, d = compose(p, kind, dy=0, arm_r="up" if i % 2 == 0 else "hold",
                         eyes="happy", tilt=tilt)
        if hand_prop:
            hf, hdx, hdy = hand_prop
            hf(d, p, 33 + hdx, 18 + hdy + (i % 2) * 2)
        else:
            spark(d, p, 42, 12 + (i % 2), 2)
        wave.append(img)
    F["waving"] = wave

    # --- row 4: jumping (5)
    jump = []
    specs = [("crouch", 2, "down"), ("stand", -3, "up"), ("tuck", -6, "up"),
             ("tuck", -4, "up"), ("crouch", 1, "down")]
    for i, (legs, dy, arms) in enumerate(specs):
        img, d = compose(p, kind, dy=dy, legs=legs, arm_l=arms, arm_r=arms, eyes="happy")
        if i in (1, 2, 3):
            spark(d, p, 8, 30 + dy, 2)
            spark(d, p, 40, 26 + dy, 2)
        jump.append(img)
    F["jumping"] = jump

    # --- row 5: failed (8) - stagger, slump, hat tips
    fail = []
    for i in range(8):
        stage = min(i, 5)
        dy = (0, 1, 2, 3, 3, 3, 3, 3)[i]
        tilt = (0, -1, -1, -2, -2, -2, -1, -2)[i]
        img, d = compose(p, kind, dy=dy, legs="slump", arm_l="down", arm_r="down",
                         eyes="x" if i >= 2 else "open", tilt=tilt,
                         extra="sweat" if i >= 3 else None)
        if i >= 4:
            for k in range(3):                    # falling error glyph
                rect(d, 6 + k * 2, 6 + i - 4 + k, 7 + k * 2, 7 + i - 4 + k, (230, 92, 92, 255))
        fail.append(img)
    F["failed"] = fail

    # --- row 6: waiting (6) - arms crossed, foot tap, dots
    wait = []
    for i in range(6):
        legs = "tap1" if i in (1, 4) else "tap0"
        img, d = compose(p, kind, legs=legs, arm_l="cross", arm_r="cross",
                         eyes="blink" if i == 3 else "open")
        dots = (i // 2) + 1
        for k in range(dots):
            rect(d, 38 + k * 3, 8, 39 + k * 3, 9, p["accent"])
        wait.append(img)
    F["waiting"] = wait

    # --- row 7: running/working (6) - typing on console
    work = []
    for i in range(6):
        dy = i % 2
        img, d = compose(p, kind, dy=dy, legs="stand", arm_l="point", arm_r="point",
                         eyes="scan", lean=1)
        work_prop[0](d, p, 16 + work_prop[1], 36 + dy + work_prop[2], i)
        if i % 3 == 0:
            spark(d, p, 40, 30, 2)
        work.append(img)
    F["running"] = work

    # --- row 8: review (6) - magnifier sweep + scan visor
    rev = []
    for i in range(6):
        dy = (0, 0, 1, 1, 0, 0)[i]
        img, d = compose(p, kind, dy=dy, arm_l="down", arm_r="hold", eyes="scan")
        mx = (34, 36, 38, 38, 36, 34)[i]
        review_prop[0](d, p, mx + review_prop[1], 12 + dy + review_prop[2], i)
        if kind in ("spy", "scout"):
            draw_switch_glyph(d, p, 4, 40 + dy, i % 2 == 0)
        rev.append(img)
    F["review"] = rev

    return F


ORDER = ["idle", "running-right", "running-left", "waving", "jumping",
         "failed", "waiting", "running", "review"]


def build_sheet(p, kind, props=None):
    F = build_frames(p, kind, props)
    sheet = Image.new("RGBA", (COLS * FW, ROWS * FH), (0, 0, 0, 0))
    for r, name in enumerate(ORDER):
        frames = F[name]
        assert len(frames) == ROW_FRAMES[r], f"{name}: {len(frames)} != {ROW_FRAMES[r]}"
        for c, fr in enumerate(frames):
            big = fr.resize((FW, FH), Image.NEAREST)
            sheet.paste(big, (c * FW, r * FH))
    return sheet, F


PETS = [
    dict(id="agent-switch", kind="spy", pal=SPY,
         displayName="Agent 007 Switch",
         description="A trench-coated field agent that swaps identities as fast as you swap Claude profiles. Ships with agent-switch."),
    dict(id="agent-config-warden", kind="warden", pal=WARDEN,
         displayName="Iron Law Warden",
         description="Helmeted guardian of the kernel. Reviews, gates and enforces the Iron Laws while your agent works. Ships with agent-config."),
    dict(id="agent-switch-scout", kind="scout", pal=SCOUT,
         displayName="Recon Scout",
         description="Field scout for multi-profile work: quiet, fast and always watching which session is live."),
    dict(id="event4u-raver", kind="raver", pal=RAVER,
         displayName="Festival Raver",
         description="Backwards cap, big headphones, wristband and a lanyard that never comes off. Scans your ticket while the agent works.",
         props=dict(review="scanner", work="console", hand="glowstick")),
    dict(id="event4u-stage-crew", kind="crew", pal=CREW,
         displayName="Stage Crew",
         description="Beanie, headset and hi-vis. Runs the mixing desk, checks the rider and gets the show on time.",
         props=dict(review="clipboard", work="mixer", hand="none")),
    dict(id="event4u-bard", kind="bard", pal=BARD,
         displayName="Folk Metal Bard",
         description="Long hair, studded belt, axe on the back. Celebrates every green build with a power chord.",
         props=dict(review="clipboard", work="console", hand="guitar")),
    dict(id="dev-bot", kind="dev", pal=DEVBOT,
         displayName="Dev Bot",
         description="Hoodie up, terminal-green visor, coffee in reach. The default companion for long refactor sessions.",
         props=dict(review="magnifier", work="console", hand="mug")),
    dict(id="the-ceo", kind="ceo", pal=CEO,
         displayName="The CEO",
         description="Sharp suit, power tie, earpiece. Reviews the numbers, asks about the roadmap and celebrates your metrics.",
         props=dict(review="chart", work="chart", hand="mug")),
]


def main(outroot="/home/claude/out"):
    os.makedirs(outroot, exist_ok=True)
    for spec in PETS:
        d = os.path.join(outroot, spec["id"])
        os.makedirs(d, exist_ok=True)
        sheet, F = build_sheet(spec["pal"], spec["kind"], spec.get("props"))
        sheet.save(os.path.join(d, "spritesheet.webp"), "WEBP", lossless=True, quality=100, method=6)
        json.dump({"id": spec["id"], "displayName": spec["displayName"],
                   "description": spec["description"], "spritesheetPath": "spritesheet.webp"},
                  open(os.path.join(d, "pet.json"), "w"), indent=2)
        # thumbnail from idle frame 0
        thumb = F["idle"][0].resize((256, 256 * H // W), Image.NEAREST)
        canvas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
        canvas.paste(thumb, (0, (256 - thumb.height) // 2))
        canvas.save(os.path.join(d, "thumbnail.png"))
        print(spec["id"], sheet.size, os.path.getsize(os.path.join(d, "spritesheet.webp")))


if __name__ == "__main__":
    main()
