#!/usr/bin/env python3
"""ตัดภาพทีละช่องจากชุดข้อมูลที่ส่งออกจาก CheckChoice (หน้า "ข้อมูลสำหรับ Train")

    python3 tools/make_cells.py checkchoice-dataset-2026-10-22.zip cells/ [--size 64] [--margin 0.08]

ผลลัพธ์
    cells/mark/       ช่องที่กากบาท (คำตอบที่อาจารย์ยืนยัน)
    cells/blank/      ช่องว่าง
    cells/cancelled/  ช่องที่ระบายทึบเพื่อยกเลิกคำตอบ
    cells/cells.csv   path,label,sheet,source,template,q,choice,density

ใช้เฉพาะข้อที่อาจารย์ยืนยันแล้ว (confirmed = true) ต้องใช้ Pillow
"""
import argparse
import csv
import io
import json
import os
import sys
import zipfile
from collections import Counter

try:
    from PIL import Image
except ImportError:
    sys.exit('ต้องติดตั้ง Pillow ก่อน: pip install pillow')

LETTERS = 'ABCDEFGH'


def cell_of(t, q, c):
    """ตำแหน่ง (row, col) ของข้อ q (เริ่มที่ 1) ตัวเลือก c (เริ่มที่ 0) ตรงกับ js/omr/core.js"""
    if t.get('order') == 'across':
        b, r = (q - 1) % t['blocks'], (q - 1) // t['blocks']
    else:
        b, r = (q - 1) // t['rowsPerBlock'], (q - 1) % t['rowsPerBlock']
    num = 1 if t.get('numberColumn', True) else 0
    return t['headerRows'] + r, b * (t['choices'] + num) + num + c


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dataset', help='ไฟล์ .zip ที่ส่งออกจากแอป หรือโฟลเดอร์ที่แตกไฟล์แล้ว')
    ap.add_argument('out', help='โฟลเดอร์ปลายทาง')
    ap.add_argument('--size', type=int, default=64, help='ขนาดภาพช่อง (พิกเซล) ค่าเริ่มต้น 64')
    ap.add_argument('--margin', type=float, default=0.08, help='ตัดขอบช่องออกกี่ส่วน (ไม่ให้เส้นตารางติดมา)')
    args = ap.parse_args()

    if os.path.isdir(args.dataset):
        read = lambda name: open(os.path.join(args.dataset, name), 'rb').read()
    else:
        zf = zipfile.ZipFile(args.dataset)
        read = zf.read
    data = json.loads(read('dataset.json').decode('utf-8'))
    if data.get('format') != 'checkchoice-dataset':
        sys.exit('ไฟล์นี้ไม่ใช่ชุดข้อมูลของ CheckChoice')

    for label in ('mark', 'blank', 'cancelled'):
        os.makedirs(os.path.join(args.out, label), exist_ok=True)
    counts = Counter()
    with open(os.path.join(args.out, 'cells.csv'), 'w', newline='', encoding='utf-8') as fcsv:
        w = csv.writer(fcsv)
        w.writerow(['path', 'label', 'sheet', 'source', 'template', 'q', 'choice', 'density'])
        for sheet in data['sheets']:
            t = data['templates'][sheet['templateId']]
            img = Image.open(io.BytesIO(read(sheet['file']))).convert('RGB')
            xs, ys = sheet['xs'], sheet['ys']
            for qd in sheet['questions']:
                if not qd.get('confirmed'):
                    continue
                ch = qd.get('choice')
                marked = set(ch) if isinstance(ch, list) else ({ch} if ch is not None else set())
                for c in range(t['choices']):
                    if c in marked:
                        label = 'mark'
                    elif qd.get('cancelled') == c:
                        label = 'cancelled'
                    else:
                        label = 'blank'
                    row, col = cell_of(t, qd['q'], c)
                    x0, x1, y0, y1 = xs[col], xs[col + 1], ys[row], ys[row + 1]
                    mx, my = (x1 - x0) * args.margin, (y1 - y0) * args.margin
                    crop = img.crop((round(x0 + mx), round(y0 + my), round(x1 - mx), round(y1 - my)))
                    crop = crop.resize((args.size, args.size), Image.BILINEAR)
                    name = f"{sheet['id']}_q{qd['q']:03d}_{LETTERS[c]}.png"
                    rel = os.path.join(label, name)
                    crop.save(os.path.join(args.out, rel))
                    density = qd.get('density')
                    w.writerow([rel, label, sheet['id'], sheet['source'], sheet['templateId'], qd['q'], LETTERS[c],
                                '' if not density else density[c]])
                    counts[label] += 1
    print(f"ตัดภาพแล้ว {sum(counts.values())} ช่องจาก {len(data['sheets'])} ภาพ: "
          + ', '.join(f'{k} {v}' for k, v in sorted(counts.items())))


if __name__ == '__main__':
    main()
