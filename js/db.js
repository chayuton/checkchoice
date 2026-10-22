// ที่เก็บข้อมูลในเครื่อง (IndexedDB) — ข้อมูลไม่ถูกส่งออกนอกอุปกรณ์
const DB_NAME = 'checkchoice';
const DB_VERSION = 2; // v2: เพิ่มที่เก็บแบบฟอร์มกระดาษคำตอบ (templates)
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined' || indexedDB === null) {
    return Promise.reject(new Error('เบราว์เซอร์นี้ปิดที่เก็บข้อมูลในเครื่อง (IndexedDB) อยู่ ถ้าใช้ iPhone ให้ปิดโหมดล็อกดาวน์แล้วรีสตาร์ทเครื่อง'));
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('exams')) db.createObjectStore('exams', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('results')) {
        const s = db.createObjectStore('results', { keyPath: 'id' });
        s.createIndex('examId', 'examId', { unique: false });
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // ถ้าแท็บอื่นเปิดแอปเวอร์ชันใหม่ที่ต้องปรับฐานข้อมูล ให้ปิดการเชื่อมต่อของแท็บนี้แล้วโหลดใหม่
      db.onversionchange = () => { db.close(); location.reload(); };
      notify('checkchoice:db-ready');
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // แท็บอื่นยังเปิดแอปเวอร์ชันเก่าค้างไว้ (1.1.0 ลงมาไม่ปิดการเชื่อมต่อให้เอง) คำขอนี้จะรอจนแท็บนั้นปิด
    // ให้หน้าจอบอกผู้ใช้ แทนที่จะค้างเป็นหน้าว่าง
    req.onblocked = () => notify('checkchoice:db-blocked');
  });
  return dbPromise;
}

function notify(type) {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(type)); } catch (e) { /* ignore */ }
}

function run(storeNames, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let out;
    Promise.resolve(fn(tx)).then((v) => { out = v; }, reject);
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('ยกเลิกการบันทึก'));
  }));
}

const reqP = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export const db = {
  get(store, id) {
    return run([store], 'readonly', (tx) => reqP(tx.objectStore(store).get(id)));
  },
  getAll(store) {
    return run([store], 'readonly', (tx) => reqP(tx.objectStore(store).getAll()));
  },
  getAllByIndex(store, index, value) {
    return run([store], 'readonly', (tx) => reqP(tx.objectStore(store).index(index).getAll(value)));
  },
  put(store, value) {
    return run([store], 'readwrite', (tx) => reqP(tx.objectStore(store).put(value)));
  },
  putMany(store, values) {
    return run([store], 'readwrite', (tx) => Promise.all(values.map((v) => reqP(tx.objectStore(store).put(v)))));
  },
  delete(store, id) {
    return run([store], 'readwrite', (tx) => reqP(tx.objectStore(store).delete(id)));
  },
  /** ลบชุดข้อสอบพร้อมผลตรวจและรูปทั้งหมด */
  deleteExamCascade(examId) {
    // ใช้ callback แทน await เพื่อให้ทรานแซกชันยังทำงานอยู่ใน Safari รุ่นเก่า
    return run(['exams', 'results', 'blobs'], 'readwrite', (tx) => {
      const results = tx.objectStore('results');
      const blobs = tx.objectStore('blobs');
      const req = results.index('examId').getAll(examId);
      req.onsuccess = () => {
        for (const r of req.result) {
          results.delete(r.id);
          if (r.imageId) blobs.delete(r.imageId);
        }
      };
      blobs.delete(`key:${examId}:original`);
      blobs.delete(`key:${examId}:table`);
      tx.objectStore('exams').delete(examId);
    });
  },
  /** ลบผลตรวจหนึ่งรายการพร้อมรูป */
  deleteResult(result) {
    return run(['results', 'blobs'], 'readwrite', (tx) => {
      tx.objectStore('results').delete(result.id);
      if (result.imageId) tx.objectStore('blobs').delete(result.imageId);
    });
  },
  /** อ่านทุกอย่างสำหรับไฟล์สำรอง */
  dumpAll() {
    return run(['exams', 'results', 'blobs', 'templates'], 'readonly', (tx) => Promise.all([
      reqP(tx.objectStore('exams').getAll()),
      reqP(tx.objectStore('results').getAll()),
      reqP(tx.objectStore('blobs').getAll()),
      reqP(tx.objectStore('templates').getAll()),
    ]).then(([exams, results, blobs, templates]) => ({ exams, results, blobs, templates })));
  },
};
