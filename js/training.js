// รวบรวมข้อมูลสำหรับ Train: ภาพตารางที่ดัดตรงแล้ว + คำตอบที่อาจารย์ยืนยัน ส่งออกเป็น ZIP
// ภาพมีเฉพาะส่วนตารางคำตอบ ไม่มีหัวกระดาษที่เขียนชื่อนักศึกษา
import { listExams, listResults, listTemplates, getBlob } from './store.js';
import { download } from './export.js';
import { APP_VERSION } from './pwa.js';

const OMR = self.OMRCore;

const cleanTemplate = (t) => {
  const c = Object.assign({}, t);
  delete c.sampleGeom;
  delete c.hasSample;
  return c;
};

/** รวบรวมแผ่นที่ใช้ Train ได้ และสรุปจำนวนช่องตามป้าย */
export async function collectDataset() {
  const [exams, templates] = await Promise.all([listExams(), listTemplates()]);
  const sheets = [];
  for (const exam of exams) {
    const t = exam.template;
    const total = OMR.questionCount(t);
    for (const r of await listResults(exam.id)) {
      if (!r.imageId || !r.geom) continue;
      const questions = [];
      for (let i = 0; i < total; i++) {
        const it = r.items[i] || {};
        questions.push({
          q: i + 1,
          choice: it.choice == null ? null : it.choice,
          cancelled: it.cancelled == null ? null : it.cancelled,
          flag: it.flag || null,
          edited: !!it.edited,
          confirmed: i < exam.questionCount && (!it.flag || !!it.resolved),
          density: r.densities && r.densities[i] ? r.densities[i] : null,
        });
      }
      sheets.push({ id: `res_${exam.id}_${r.studentNo}`, source: 'result', examId: exam.id, studentNo: r.studentNo,
        template: cleanTemplate(t), imageId: r.imageId, geom: r.geom, questions });
    }
    if (exam.hasKeyImage && exam.keyGeom) {
      const questions = Array.from({ length: total }, (_, i) => ({
        q: i + 1,
        choice: exam.key[i] == null ? null : exam.key[i],
        cancelled: null,
        flag: null,
        edited: false,
        confirmed: i < exam.questionCount && OMR.choiceSet(exam.key[i]).length > 0,
        density: exam.keyDensities && exam.keyDensities[i] ? exam.keyDensities[i] : null,
      }));
      sheets.push({ id: `key_${exam.id}`, source: 'key', examId: exam.id, template: cleanTemplate(t),
        imageId: `key:${exam.id}:table`, geom: exam.keyGeom, questions });
    }
  }
  for (const t of templates) {
    if (!t.custom || !t.hasSample || !t.sampleGeom) continue;
    const { cols, rows } = OMR.gridShape(t);
    if (t.sampleGeom.xs.length !== cols + 1 || t.sampleGeom.ys.length !== rows + 1) continue;
    const questions = Array.from({ length: OMR.questionCount(t) }, (_, i) => ({
      q: i + 1, choice: null, cancelled: null, flag: 'blank', edited: false, confirmed: true, density: null,
    }));
    sheets.push({ id: `blank_${t.id}`, source: 'blank', template: cleanTemplate(t), imageId: `tpl:${t.id}:blank`, geom: t.sampleGeom, questions });
  }

  const stats = { sheets: sheets.length, bySource: { result: 0, key: 0, blank: 0 }, cells: { mark: 0, blank: 0, cancelled: 0 }, templates: {} };
  for (const s of sheets) {
    stats.bySource[s.source]++;
    stats.templates[s.template.name] = (stats.templates[s.template.name] || 0) + 1;
    for (const q of s.questions) {
      if (!q.confirmed) continue;
      for (let c = 0; c < s.template.choices; c++) {
        if (OMR.choiceSet(q.choice).includes(c)) stats.cells.mark++;
        else if (q.cancelled === c) stats.cells.cancelled++;
        else stats.cells.blank++;
      }
    }
  }
  return { sheets, stats };
}

const README = `ชุดข้อมูลจาก CheckChoice สำหรับฝึกโมเดลอ่านกระดาษคำตอบ
=========================================================

images/<id>.jpg   ภาพตารางคำตอบที่ดัดตรงแล้ว (เฉพาะส่วนตาราง ไม่มีชื่อนักศึกษา)
dataset.json      ข้อมูลของแต่ละภาพ

dataset.json
  templates[id]            โครงตาราง: blocks, rowsPerBlock, choices, headerRows, numberColumn, order
  sheets[]                 หนึ่งรายการต่อหนึ่งภาพ
    source                 result = กระดาษนักศึกษา, key = ใบเฉลย, blank = กระดาษเปล่าของแบบฟอร์ม
    xs, ys                 ตำแหน่งเส้นตารางแนวตั้ง/แนวนอน (พิกเซลของภาพ)
    questions[]
      q                    เลขข้อ
      choice               ตัวเลือกที่เป็นคำตอบ (0 = A, 1 = B, …) อาร์เรย์ของตัวเลือก (กากบาทหลายช่อง) หรือ null
      cancelled            ตัวเลือกที่ระบายทึบเพื่อยกเลิก หรือ null
      confirmed            true = อาจารย์ยืนยันแล้ว ใช้เป็นป้ายได้ (false = ไม่ควรใช้)
      density              สัดส่วนหมึกของแต่ละตัวเลือกที่แอปวัดได้

ตำแหน่งช่องของข้อ q ตัวเลือก c:
  order = down   : b = (q-1) // rowsPerBlock, r = (q-1) % rowsPerBlock
  order = across : b = (q-1) % blocks,       r = (q-1) // blocks
  row = headerRows + r
  col = b * (choices + numberColumn) + numberColumn + c
  ช่อง = xs[col]..xs[col+1], ys[row]..ys[row+1]

ตัดภาพทีละช่องแยกตามป้าย (mark / blank / cancelled):
  python3 tools/make_cells.py checkchoice-dataset.zip cells/
(สคริปต์อยู่ใน https://github.com/chayuton/checkchoice)
`;

/** สร้างไฟล์ ZIP แล้วดาวน์โหลด */
export async function exportDatasetZip() {
  const { zipSync, strToU8 } = await import('../vendor/fflate.mjs');
  const { sheets, stats } = await collectDataset();
  const files = {};
  const out = [];
  const templates = {};
  for (const s of sheets) {
    const blob = await getBlob(s.imageId);
    if (!blob) continue;
    const { cols, rows } = OMR.gridShape(s.template);
    if (s.geom.xs.length !== cols + 1 || s.geom.ys.length !== rows + 1) continue;
    const file = `images/${s.id}.jpg`;
    files[file] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
    const sc = s.geom.scale || 1;
    templates[s.template.id] = s.template;
    out.push({
      id: s.id, file, source: s.source, examId: s.examId || null, studentNo: s.studentNo || null, templateId: s.template.id,
      xs: s.geom.xs.map((x) => Math.round(x * sc * 100) / 100),
      ys: s.geom.ys.map((y) => Math.round(y * sc * 100) / 100),
      questions: s.questions,
    });
  }
  if (!out.length) throw new Error('ยังไม่มีข้อมูล ตรวจกระดาษและบันทึกผลก่อน แล้วค่อยส่งออก');
  const dataset = {
    format: 'checkchoice-dataset', version: 1, app: APP_VERSION, exportedAt: new Date().toISOString(),
    templates, sheets: out,
  };
  files['dataset.json'] = strToU8(JSON.stringify(dataset));
  files['README.txt'] = strToU8(README);
  const zipped = zipSync(files, { level: 6 });
  const stamp = new Date().toISOString().slice(0, 10);
  download(new Blob([zipped], { type: 'application/zip' }), `checkchoice-dataset-${stamp}.zip`);
  return { sheets: out.length, stats };
}
