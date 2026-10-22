// ข้อมูลสำหรับ Train: สรุปและส่งออกชุดข้อมูล
import { h, icon, toast, plural } from '../ui.js';
import { appBar } from '../nav.js';
import { collectDataset, exportDatasetZip } from '../training.js';
import { REPO_URL } from '../pwa.js';

export async function trainingView(root) {
  const { stats } = await collectDataset();
  root.append(appBar({ title: 'ข้อมูลสำหรับ Train', back: '#/' }));
  const main = h('main', { class: 'page page-form' });
  root.append(main);

  main.append(h('p', { class: 'section-help lead' },
    'ทุกครั้งที่ตรวจและยืนยันคำตอบ แอปเก็บภาพตารางคำตอบคู่กับคำตอบที่อาจารย์ยืนยันไว้ ส่งออกเป็นชุดข้อมูลไว้ฝึกโมเดลอ่านกระดาษคำตอบภายหลังได้'));

  const fmt = (n) => n.toLocaleString('th-TH');
  main.append(h('dl', { class: 'stats', id: 'training-stats' },
    h('div', null, h('dt', null, 'ภาพทั้งหมด'), h('dd', null, fmt(stats.sheets))),
    h('div', null, h('dt', null, 'ช่องที่กากบาท'), h('dd', null, fmt(stats.cells.mark))),
    h('div', null, h('dt', null, 'ช่องว่าง'), h('dd', null, fmt(stats.cells.blank))),
    h('div', null, h('dt', null, 'ช่องระบายยกเลิก'), h('dd', null, fmt(stats.cells.cancelled)))));

  main.append(h('section', { class: 'form-section' },
    h('h2', { class: 'section-title' }, 'ที่มาของภาพ'),
    h('ul', { class: 'help-steps' },
      h('li', null, `กระดาษนักศึกษาที่ตรวจแล้ว ${plural(stats.bySource.result, 'แผ่น')}`),
      h('li', null, `ใบเฉลย ${plural(stats.bySource.key, 'แผ่น')}`),
      h('li', null, `กระดาษเปล่าของแบบฟอร์มที่เพิ่มเอง ${plural(stats.bySource.blank, 'แผ่น')}`)),
    Object.keys(stats.templates).length ? h('p', { class: 'section-help' },
      'แยกตามแบบฟอร์ม: ' + Object.entries(stats.templates).map(([n, c]) => `${n} ${c} แผ่น`).join(', ')) : null));

  const btn = h('button', { type: 'button', class: 'btn btn-primary btn-large', id: 'btn-export-dataset', disabled: !stats.sheets, onclick: async () => {
    btn.disabled = true;
    try {
      const r = await exportDatasetZip();
      toast(`ดาวน์โหลดชุดข้อมูลแล้ว (${plural(r.sheets, 'ภาพ')})`, 'ok');
    } catch (err) {
      toast(err.message || String(err), 'error');
    } finally {
      btn.disabled = false;
    }
  } }, icon('download'), 'ดาวน์โหลดชุดข้อมูล (.zip)');
  main.append(h('div', { class: 'btn-row' }, btn));

  main.append(h('section', { class: 'form-section' },
    h('h2', { class: 'section-title' }, 'ในไฟล์มีอะไร'),
    h('ul', { class: 'help-steps' },
      h('li', null, 'ภาพตารางคำตอบที่ดัดตรงแล้ว เฉพาะส่วนตาราง ไม่มีหัวกระดาษที่เขียนชื่อนักศึกษา'),
      h('li', null, 'ตำแหน่งเส้นตาราง โครงแบบฟอร์ม และคำตอบที่อาจารย์ยืนยันของทุกข้อ (ข้อที่ยังไม่ยืนยันจะติดป้ายว่าไม่ควรใช้)'),
      h('li', null, 'ค่าหมึกที่แอปวัดได้ในแต่ละช่อง ใช้เทียบกับโมเดลใหม่ได้')),
    h('p', { class: 'section-help' }, 'ตัดภาพทีละช่องแยกตามป้าย (กากบาท / ว่าง / ระบายยกเลิก) ด้วยสคริปต์ ',
      h('a', { class: 'link', href: `${REPO_URL}/blob/main/tools/make_cells.py`, target: '_blank', rel: 'noopener' }, 'tools/make_cells.py'),
      ' บน GitHub')));
}
