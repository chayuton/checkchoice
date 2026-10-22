#!/usr/bin/env python3
"""สร้างภาพกระดาษคำตอบจำลองสำหรับทดสอบแบบฟอร์มที่มีข้อมากกว่า 60 ข้อ

    python3 tests/synth/make_sheets.py

เขียนไฟล์ tests/fixtures/synth-<form>-{blank,key,student}.jpg และ tests/fixtures/synth-truth.json
ภาพผ่านการจำลองการถ่ายด้วยมือถือ (มุมเอียง เบลอ แสงไม่เท่ากัน สัญญาณรบกวน) และสุ่มแบบกำหนด seed
จึงสร้างซ้ำได้ผลเดิม ต้องใช้ numpy, opencv-python, Pillow และ fontTools (+brotli สำหรับฟอนต์ไทย)
"""
import json
import math
import os
import random
import tempfile

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'tests', 'fixtures')
LATIN = 'ABCDEFGH'
THAI = 'กขคงจฉชซ'

FORMS = [
    # id ตรงกับแบบฟอร์มสำเร็จรูปในแอป
    dict(id='grid-100x5', blocks=5, rows=20, choices=5, header=2, page=(2600, 1840), seed=100),
    dict(id='grid-120x4', blocks=4, rows=30, choices=4, header=2, page=(1840, 2600), seed=120),
]


def thai_font_path():
    """แปลงฟอนต์ IBM Plex Sans Thai Looped (woff2 ในแอป) เป็น TTF ชั่วคราวให้ Pillow ใช้"""
    from fontTools.ttLib import TTFont
    src = os.path.join(ROOT, 'fonts', 'plex-thai-looped-thai-500.woff2')
    f = TTFont(src)
    f.flavor = None
    out = os.path.join(tempfile.gettempdir(), 'cc-plex-thai.ttf')
    f.save(out)
    return out


def latin_font_path():
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/Library/Fonts/Arial.ttf', 'C:/Windows/Fonts/arial.ttf']:
        if os.path.exists(p):
            return p
    raise SystemExit('ไม่พบฟอนต์ภาษาอังกฤษ')


def is_thai(ch):
    return '฀' <= ch <= '๿'


def draw_mixed(d, xy, text, thai, latin, fill, center=False):
    """วาดข้อความที่มีทั้งอักษรไทยและตัวเลข/จุด โดยใช้ฟอนต์ที่มีตัวอักษรนั้นจริง"""
    runs = []
    for ch in text:
        f = thai if is_thai(ch) else latin
        if runs and runs[-1][0] is f:
            runs[-1][1] += ch
        else:
            runs.append([f, ch])
    total = sum(d.textlength(t, font=f) for f, t in runs)
    x, y = xy
    if center:
        x -= total / 2
    for f, t in runs:
        d.text((x, y), t, font=f, fill=fill, anchor='ls')
        x += d.textlength(t, font=f)


def draw_sheet(form, fonts):
    W, H = form['page']
    img = Image.new('RGB', (W, H), (250, 250, 247))
    d = ImageDraw.Draw(img)
    per = form['choices'] + 1
    cols = form['blocks'] * per
    rows = form['header'] + form['rows']
    margin = int(W * 0.05)
    top = int(H * 0.17)
    tw = W - 2 * margin
    cw = tw / cols
    ch = min(cw * 0.9, (H - top - margin) / rows)
    th = ch * rows
    x0, y0 = margin, top

    big = ImageFont.truetype(fonts['thai'], int(H * 0.028))
    big_l = ImageFont.truetype(fonts['latin'], int(H * 0.026))
    small = ImageFont.truetype(fonts['thai'], int(H * 0.018))
    small_l = ImageFont.truetype(fonts['latin'], int(H * 0.016))
    lat = ImageFont.truetype(fonts['latin'], int(ch * 0.42))
    num = ImageFont.truetype(fonts['latin'], int(ch * 0.38))
    tha = ImageFont.truetype(fonts['thai'], int(ch * 0.40))

    # หัวกระดาษ (ข้อความและเส้นประ ให้คล้ายกระดาษจริง)
    q_total = form['blocks'] * form['rows']
    draw_mixed(d, (W / 2, H * 0.06), f'กระดาษคำตอบปรนัย {q_total} ข้อ', big, big_l, (40, 40, 40), center=True)
    dots = int(W / 60)
    draw_mixed(d, (margin, H * 0.105), 'ชื่อ - นามสกุล ' + '.' * dots * 2 + '  เลขที่ ' + '.' * (dots // 2), small, small_l, (60, 60, 60))
    draw_mixed(d, (margin, H * 0.14), 'รายวิชา ' + '.' * dots + '  สอบวันที่ ' + '.' * dots, small, small_l, (60, 60, 60))

    def cx(c):
        return x0 + c * cw

    def cy(r):
        return y0 + r * ch

    # เส้นตาราง
    for r in range(rows + 1):
        d.line([(x0, cy(r)), (x0 + tw, cy(r))], fill=(55, 55, 55), width=2)
    for c in range(cols + 1):
        d.line([(cx(c), y0), (cx(c), y0 + th)], fill=(55, 55, 55), width=2)
    d.rectangle([x0, y0, x0 + tw, y0 + th], outline=(30, 30, 30), width=4)

    # หัวตาราง
    for b in range(form['blocks']):
        c0 = b * per
        d.text(((cx(c0) + cx(c0 + 1)) / 2, (cy(0) + cy(1)) / 2), 'ข้อ', font=tha, fill=(50, 50, 50), anchor='mm')
        for k in range(form['choices']):
            c = c0 + 1 + k
            d.text(((cx(c) + cx(c + 1)) / 2, (cy(0) + cy(1)) / 2), LATIN[k], font=lat, fill=(40, 40, 40), anchor='mm')
            if form['header'] >= 2:
                d.text(((cx(c) + cx(c + 1)) / 2, (cy(1) + cy(2)) / 2), THAI[k], font=tha, fill=(60, 60, 60), anchor='mm')
        for r in range(form['rows']):
            qn = b * form['rows'] + r + 1
            rr = form['header'] + r
            d.text(((cx(c0) + cx(c0 + 1)) / 2, (cy(rr) + cy(rr + 1)) / 2), str(qn), font=num, fill=(70, 70, 70), anchor='mm')
    geo = dict(x0=x0, y0=y0, cw=cw, ch=ch, per=per)
    return np.array(img)[:, :, ::-1].copy(), geo


def cell_box(form, geo, q, c):
    b = (q - 1) // form['rows']
    r = (q - 1) % form['rows']
    col = b * geo['per'] + 1 + c
    row = form['header'] + r
    return (geo['x0'] + col * geo['cw'], geo['y0'] + row * geo['ch'], geo['cw'], geo['ch'])


def pen_x(img, box, rng, heavy=False):
    x, y, w, h = box
    s = min(w, h)
    cxm, cym = x + w / 2 + rng.uniform(-0.08, 0.08) * w, y + h / 2 + rng.uniform(-0.08, 0.08) * h
    half = s * rng.uniform(0.25, 0.34)
    color = (int(rng.uniform(140, 175)), int(rng.uniform(45, 75)), int(rng.uniform(20, 45)))
    th = 4 if heavy else rng.choice([2, 3, 3])
    for sign in (1, -1):
        p0 = (cxm - half + rng.uniform(-3, 3), cym - sign * half + rng.uniform(-3, 3))
        p1 = (cxm + half + rng.uniform(-3, 3), cym + sign * half + rng.uniform(-3, 3))
        bend = rng.uniform(-0.12, 0.12) * half
        pts = []
        for i in range(16):
            t = i / 15
            px = p0[0] + (p1[0] - p0[0]) * t
            py = p0[1] + (p1[1] - p0[1]) * t + math.sin(math.pi * t) * bend
            pts.append((px, py))
        cv2.polylines(img, [np.array(pts, np.int32)], False, color, th, cv2.LINE_AA)


def scribble(img, box, rng):
    x, y, w, h = box
    color = (int(rng.uniform(140, 170)), int(rng.uniform(50, 70)), int(rng.uniform(25, 45)))
    pts = []
    for i in range(34):
        px = x + w * (0.18 + 0.64 * rng.random())
        py = y + h * (0.2 + 0.6 * (i % 2) + rng.uniform(-0.1, 0.1))
        pts.append((px, py))
    cv2.polylines(img, [np.array(pts, np.int32)], False, color, 4, cv2.LINE_AA)


def photo(img, rng):
    """จำลองการถ่ายด้วยมือถือ"""
    h, w = img.shape[:2]
    pad = int(max(w, h) * 0.08)
    desk = np.full((h + 2 * pad, w + 2 * pad, 3), (rng.randint(150, 185),) * 3, np.uint8)
    desk[pad:pad + h, pad:pad + w] = img
    H2, W2 = desk.shape[:2]
    src = np.float32([[0, 0], [W2, 0], [W2, H2], [0, H2]])
    j = lambda: rng.uniform(-0.035, 0.035)
    dst = np.float32([[W2 * j(), H2 * j()], [W2 * (1 + j()), H2 * j()], [W2 * (1 + j()), H2 * (1 + j())], [W2 * j(), H2 * (1 + j())]])
    M = cv2.getPerspectiveTransform(src, dst)
    out = cv2.warpPerspective(desk, M, (W2, H2), borderValue=(160, 160, 160))
    gx = np.linspace(rng.uniform(0.72, 0.9), rng.uniform(0.98, 1.05), W2)[None, :, None]
    gy = np.linspace(1.0, rng.uniform(0.85, 1.0), H2)[:, None, None]
    out = np.clip(out.astype(np.float32) * gx * gy, 0, 255)
    out = cv2.GaussianBlur(out, (0, 0), rng.uniform(0.8, 1.2))
    out = np.clip(out + np.random.default_rng(rng.randint(0, 9999)).normal(0, 3.5, out.shape), 0, 255).astype(np.uint8)
    s = 2400 / max(out.shape[:2])
    return cv2.resize(out, (int(out.shape[1] * s), int(out.shape[0] * s)), interpolation=cv2.INTER_AREA)


def main():
    fonts = {'thai': thai_font_path(), 'latin': latin_font_path()}
    truth = {}
    for form in FORMS:
        rng = random.Random(form['seed'])
        n = form['blocks'] * form['rows']
        base, geo = draw_sheet(form, fonts)
        cv2.imwrite(os.path.join(OUT, f"synth-{form['id']}-blank.jpg"), photo(base, rng), [cv2.IMWRITE_JPEG_QUALITY, 82])

        key = [rng.randrange(form['choices']) for _ in range(n)]
        img = base.copy()
        for q in range(1, n + 1):
            pen_x(img, cell_box(form, geo, q, key[q - 1]), rng)
        cv2.imwrite(os.path.join(OUT, f"synth-{form['id']}-key.jpg"), photo(img, rng), [cv2.IMWRITE_JPEG_QUALITY, 82])

        img = base.copy()
        expected, flags = [], {}
        for q in range(1, n + 1):
            u = rng.random()
            a = rng.randrange(form['choices'])
            if u < 0.05:
                expected.append('-'); flags[q] = 'blank'
            elif u < 0.09:
                b2 = (a + 1 + rng.randrange(form['choices'] - 1)) % form['choices']
                pen_x(img, cell_box(form, geo, q, a), rng)
                pen_x(img, cell_box(form, geo, q, b2), rng)
                expected.append('?'); flags[q] = 'multi'
            elif u < 0.13:
                b2 = (a + 1 + rng.randrange(form['choices'] - 1)) % form['choices']
                scribble(img, cell_box(form, geo, q, b2), rng)
                pen_x(img, cell_box(form, geo, q, a), rng)
                expected.append(LATIN[a]); flags[q] = 'changed'
            else:
                pen_x(img, cell_box(form, geo, q, a), rng, heavy=u > 0.97)
                expected.append(LATIN[a])
        cv2.imwrite(os.path.join(OUT, f"synth-{form['id']}-student.jpg"), photo(img, rng), [cv2.IMWRITE_JPEG_QUALITY, 82])
        truth[form['id']] = {
            'template': {k: form[k] for k in ('blocks', 'rows', 'choices', 'header')},
            'key': ''.join(LATIN[k] for k in key),
            'student': ''.join(expected),
            'flags': {str(k): v for k, v in flags.items()},
        }
        print(form['id'], 'สร้างแล้ว', n, 'ข้อ', 'ธง', len(flags))
    with open(os.path.join(OUT, 'synth-truth.json'), 'w', encoding='utf-8') as f:
        json.dump(truth, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
