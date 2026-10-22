// ที่เก็บข้อมูลในเครื่อง — ข้อมูลไม่ถูกส่งออกนอกอุปกรณ์
//
// ปกติใช้ IndexedDB ถ้าเบราว์เซอร์ปิด IndexedDB ไว้ (เช่น Safari บน iPhone ที่เปิดโหมดล็อกดาวน์
// ตั้งแต่ iOS 17) จะใช้ที่เก็บสำรองแทน: ข้อมูลข้อสอบ/ผลตรวจ/แบบฟอร์มใน localStorage และรูปใน
// Cache Storage (ถ้าเบราว์เซอร์ไม่ให้ใช้ จะเก็บรูปไว้ในหน่วยความจำจนกว่าจะปิดหน้า)
// ทุกส่วนของแอปเรียกผ่านออบเจกต์ db ด้านล่าง จึงไม่ต้องรู้ว่าใช้ที่เก็บแบบไหน
const DB_NAME = 'checkchoice';
const DB_VERSION = 2; // v2: เพิ่มที่เก็บแบบฟอร์มกระดาษคำตอบ (templates)

let selected = null;   // { kind: 'indexeddb'|'fallback'|'none', images: 'indexeddb'|'cache'|'memory'|null, impl }
let selecting = null;

function notify(type) {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(type)); } catch (e) { /* ignore */ }
}

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish(fallback), ms);
    promise.then(finish, () => finish(fallback));
  });
}

export function hasIndexedDB() {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch (e) { return false; }
}

/** ลองเปิดฐานข้อมูลทดสอบ (บางเบราว์เซอร์มีตัวแปร indexedDB แต่ใช้งานจริงไม่ได้) */
function probeIndexedDB() {
  return withTimeout(new Promise((resolve) => {
    try {
      const req = indexedDB.open('checkchoice-probe', 1);
      req.onsuccess = () => {
        try { req.result.close(); indexedDB.deleteDatabase('checkchoice-probe'); } catch (e) { /* ignore */ }
        resolve(true);
      };
      req.onerror = () => resolve(false);
      req.onblocked = () => resolve(true);
    } catch (e) {
      resolve(false);
    }
  }), 4000, false);
}

function localStorageWorks() {
  try {
    const k = 'cc.probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------
function indexedDBBackend() {
  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('exams')) d.createObjectStore('exams', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('results')) {
          const s = d.createObjectStore('results', { keyPath: 'id' });
          s.createIndex('examId', 'examId', { unique: false });
        }
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('templates')) d.createObjectStore('templates', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const d = req.result;
        // ถ้าแท็บอื่นเปิดแอปเวอร์ชันใหม่ที่ต้องปรับฐานข้อมูล ให้ปิดการเชื่อมต่อของแท็บนี้แล้วโหลดใหม่
        d.onversionchange = () => { d.close(); location.reload(); };
        notify('checkchoice:db-ready');
        resolve(d);
      };
      req.onerror = () => reject(req.error);
      // แท็บอื่นยังเปิดแอปเวอร์ชันเก่าค้างไว้ (1.1.0 ลงมาไม่ปิดการเชื่อมต่อให้เอง) คำขอนี้จะรอจนแท็บนั้นปิด
      // ให้หน้าจอบอกผู้ใช้ แทนที่จะค้างเป็นหน้าว่าง
      req.onblocked = () => notify('checkchoice:db-blocked');
    });
    return dbPromise;
  }

  function run(storeNames, mode, fn) {
    return openDB().then((d) => new Promise((resolve, reject) => {
      const tx = d.transaction(storeNames, mode);
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

  return {
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
        // ลบรูปทุกรูปของชุดนี้ตามคำนำหน้า (รวมรูปที่ไม่มีผลตรวจอ้างถึงแล้ว)
        for (const prefix of [`res:${examId}:`, `key:${examId}:`]) blobs.delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
        tx.objectStore('exams').delete(examId);
      });
    },
    /** ขนาดรูปทั้งหมด [{ id, size }] (ไม่อ่านเนื้อไฟล์) */
    blobSizes() {
      return run(['blobs'], 'readonly', (tx) => new Promise((resolve, reject) => {
        const out = [];
        const req = tx.objectStore('blobs').openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (!c) { resolve(out); return; }
          const b = c.value && c.value.blob;
          out.push({ id: c.value.id, size: b && b.size ? b.size : 0 });
          c.continue();
        };
        req.onerror = () => reject(req.error);
      }));
    },
    deleteResult(result) {
      return run(['results', 'blobs'], 'readwrite', (tx) => {
        tx.objectStore('results').delete(result.id);
        if (result.imageId) tx.objectStore('blobs').delete(result.imageId);
      });
    },
    dumpAll() {
      return run(['exams', 'results', 'blobs', 'templates'], 'readonly', (tx) => Promise.all([
        reqP(tx.objectStore('exams').getAll()),
        reqP(tx.objectStore('results').getAll()),
        reqP(tx.objectStore('blobs').getAll()),
        reqP(tx.objectStore('templates').getAll()),
      ]).then(([exams, results, blobs, templates]) => ({ exams, results, blobs, templates })));
    },
  };
}

// ---------------------------------------------------------------------------
// ที่เก็บสำรอง: localStorage (ข้อมูล) + Cache Storage หรือหน่วยความจำ (รูป)
// ---------------------------------------------------------------------------
const LS_PREFIX = 'cc.db.v1.';
// ชื่อแคชห้ามขึ้นต้นด้วย "checkchoice-" เพราะ service worker ลบแคชชื่อนั้นทุกครั้งที่อัปเดตแอป
const FILE_CACHE = 'cc-files-v1';
const FULL_MESSAGE = 'พื้นที่เก็บข้อมูลของเบราว์เซอร์นี้เต็ม (ใช้ที่เก็บสำรองเพราะปิด IndexedDB อยู่) ดาวน์โหลดไฟล์สำรองแล้วลบชุดข้อสอบเก่า หรือปิดโหมดล็อกดาวน์เฉพาะเว็บนี้เพื่อใช้ที่เก็บเต็มรูปแบบ';

function fileUrl(id) {
  return new URL(`__files/${encodeURIComponent(id)}`, document.baseURI).href;
}

async function probeCacheStorage() {
  try {
    if (typeof caches === 'undefined' || !caches || !caches.open) return false;
    return await withTimeout((async () => {
      const c = await caches.open(FILE_CACHE);
      const u = fileUrl('__probe');
      await c.put(u, new Response('ok', { headers: { 'Content-Type': 'text/plain' } }));
      const r = await c.match(u);
      const ok = !!r && (await r.text()) === 'ok';
      await c.delete(u);
      return ok;
    })(), 4000, false);
  } catch (e) {
    return false;
  }
}

function fallbackBackend(useCache) {
  // อ่านจาก localStorage ทุกครั้ง (ไม่เก็บสำเนาในหน่วยความจำ) ถ้าเปิดแอปไว้หลายแท็บข้อมูลจะไม่ทับกัน
  const read = (store) => {
    try {
      const o = JSON.parse(localStorage.getItem(LS_PREFIX + store) || '{}');
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch (e) {
      return {};
    }
  };
  const write = (store, map) => {
    try {
      localStorage.setItem(LS_PREFIX + store, JSON.stringify(map));
    } catch (e) {
      throw new Error(FULL_MESSAGE);
    }
  };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

  // รูป
  const memory = new Map();
  const cacheP = useCache ? caches.open(FILE_CACHE) : null;
  const files = {
    async get(id) {
      if (!cacheP) return memory.get(id);
      const res = await (await cacheP).match(fileUrl(id));
      if (!res) return undefined;
      const blob = await res.blob();
      return { id, blob, type: blob.type };
    },
    async put(rec) {
      const blob = rec.blob;
      if (!cacheP) { memory.set(rec.id, { id: rec.id, blob, type: rec.type || blob.type }); return; }
      try {
        await (await cacheP).put(fileUrl(rec.id), new Response(blob, {
          headers: { 'Content-Type': rec.type || blob.type || 'application/octet-stream', 'X-Size': String(blob.size) },
        }));
      } catch (e) {
        throw new Error(FULL_MESSAGE);
      }
    },
    async delete(id) {
      if (!cacheP) { memory.delete(id); return; }
      await (await cacheP).delete(fileUrl(id));
    },
    async sizes() {
      if (!cacheP) return [...memory.values()].map((r) => ({ id: r.id, size: r.blob ? r.blob.size : 0 }));
      const c = await cacheP;
      const out = [];
      for (const req of await c.keys()) {
        const m = req.url.match(/__files\/([^?#]+)$/);
        if (!m) continue;
        const res = await c.match(req);
        if (!res) continue;
        const size = Number(res.headers.get('X-Size')) || (await res.blob()).size;
        out.push({ id: decodeURIComponent(m[1]), size });
      }
      return out;
    },
    async ids() {
      if (!cacheP) return [...memory.keys()];
      const c = await cacheP;
      return (await c.keys()).map((req) => req.url.match(/__files\/([^?#]+)$/)).filter(Boolean).map((m) => decodeURIComponent(m[1]));
    },
    async all() {
      if (!cacheP) return [...memory.values()];
      const c = await cacheP;
      const out = [];
      for (const req of await c.keys()) {
        const m = req.url.match(/__files\/([^?#]+)$/);
        if (!m) continue;
        const id = decodeURIComponent(m[1]);
        const res = await c.match(req);
        if (!res) continue;
        const blob = await res.blob();
        out.push({ id, blob, type: blob.type });
      }
      return out;
    },
  };

  const api = {
    async get(store, id) {
      if (store === 'blobs') return files.get(id);
      return clone(read(store)[id]);
    },
    async getAll(store) {
      if (store === 'blobs') return files.all();
      return Object.values(read(store)).map(clone);
    },
    async getAllByIndex(store, index, value) {
      return Object.values(read(store)).filter((r) => r && r[index] === value).map(clone);
    },
    async put(store, value) {
      if (store === 'blobs') { await files.put(value); return value.id; }
      const map = read(store);
      map[value.id] = clone(value);
      write(store, map);
      return value.id;
    },
    async putMany(store, values) {
      if (store === 'blobs') { for (const v of values) await files.put(v); return; }
      const map = read(store);
      for (const v of values) map[v.id] = clone(v);
      write(store, map);
    },
    async delete(store, id) {
      if (store === 'blobs') { await files.delete(id); return; }
      const map = read(store);
      if (id in map) { delete map[id]; write(store, map); }
    },
    async deleteExamCascade(examId) {
      const results = read('results');
      const images = [];
      for (const [id, r] of Object.entries(results)) {
        if (r && r.examId === examId) {
          if (r.imageId) images.push(r.imageId);
          delete results[id];
        }
      }
      write('results', results);
      const exams = read('exams');
      delete exams[examId];
      write('exams', exams);
      // รูปทุกรูปของชุดนี้ตามคำนำหน้า (รวมรูปที่ไม่มีผลตรวจอ้างถึงแล้ว)
      const prefixes = [`res:${examId}:`, `key:${examId}:`];
      for (const id of await files.ids().catch(() => [])) if (prefixes.some((p) => id.startsWith(p))) images.push(id);
      for (const id of new Set(images)) await files.delete(id).catch(() => {});
    },
    async blobSizes() {
      return files.sizes();
    },
    async deleteResult(result) {
      await api.delete('results', result.id);
      if (result.imageId) await files.delete(result.imageId).catch(() => {});
    },
    async dumpAll() {
      return {
        exams: await api.getAll('exams'),
        results: await api.getAll('results'),
        blobs: await files.all(),
        templates: await api.getAll('templates'),
      };
    },
  };
  return api;
}

/**
 * ข้อมูลที่บันทึกไว้ตอนใช้ที่เก็บสำรอง (เช่น ตอนเปิดโหมดล็อกดาวน์) ย้ายเข้า IndexedDB เมื่อใช้ได้แล้ว
 * (เช่น ปิดโหมดล็อกดาวน์เฉพาะเว็บนี้) รายการที่มีอยู่แล้วทั้งสองที่ เก็บฉบับที่แก้ไขล่าสุด
 */
async function migrateFallbackInto(idb) {
  let hasData = false;
  try { hasData = ['exams', 'results', 'templates'].some((s) => !!localStorage.getItem(LS_PREFIX + s)); } catch (e) { return; }
  let hasFiles = false;
  try { hasFiles = typeof caches !== 'undefined' && caches && caches.has ? await caches.has(FILE_CACHE) : false; } catch (e) { /* ignore */ }
  if (!hasData && !hasFiles) return;
  try {
    const fb = fallbackBackend(hasFiles);
    const data = await fb.dumpAll();
    const imagesOf = { exams: (r) => [`key:${r.id}:original`, `key:${r.id}:table`], results: (r) => (r.imageId ? [r.imageId] : []), templates: (r) => [`tpl:${r.id}:blank`] };
    const overwrite = new Set();
    for (const store of ['templates', 'exams', 'results']) {
      const recs = [];
      for (const r of data[store]) {
        if (!r || !r.id) continue;
        const cur = await idb.get(store, r.id);
        if (!cur || (r.updatedAt || '') > (cur.updatedAt || '')) {
          recs.push(r);
          imagesOf[store](r).forEach((id) => overwrite.add(id));
        }
      }
      if (recs.length) await idb.putMany(store, recs);
    }
    const blobs = [];
    for (const b of data.blobs) {
      if (overwrite.has(b.id) || !(await idb.get('blobs', b.id))) blobs.push(b);
    }
    if (blobs.length) await idb.putMany('blobs', blobs);
    for (const s of ['exams', 'results', 'templates']) localStorage.removeItem(LS_PREFIX + s);
    if (hasFiles) await caches.delete(FILE_CACHE);
  } catch (e) {
    // ย้ายไม่สำเร็จ: เก็บข้อมูลสำรองไว้ตามเดิม ลองใหม่ครั้งหน้าที่เปิดแอป
    console.warn('ย้ายข้อมูลจากที่เก็บสำรองไม่สำเร็จ', e);
  }
}

// ---------------------------------------------------------------------------
// เลือกที่เก็บ (ครั้งเดียว) แล้วเรียกผ่าน db
// ---------------------------------------------------------------------------
/** คืน { kind, images } kind: 'indexeddb' | 'fallback' | 'none' */
export function initStorage() {
  if (selecting) return selecting;
  selecting = (async () => {
    if (hasIndexedDB() && await probeIndexedDB()) {
      selected = { kind: 'indexeddb', images: 'indexeddb', impl: indexedDBBackend() };
      await migrateFallbackInto(selected.impl);
    } else if (localStorageWorks()) {
      const cacheOk = await probeCacheStorage();
      selected = { kind: 'fallback', images: cacheOk ? 'cache' : 'memory', impl: fallbackBackend(cacheOk) };
    } else {
      selected = { kind: 'none', images: null, impl: null };
    }
    return { kind: selected.kind, images: selected.images };
  })();
  return selecting;
}

/** ที่เก็บที่ใช้อยู่ (null ถ้ายังไม่ได้เลือก) */
export function storageInfo() {
  return selected ? { kind: selected.kind, images: selected.images } : null;
}

function use(fn) {
  return initStorage().then(() => {
    if (!selected.impl) throw new Error('เบราว์เซอร์นี้ไม่อนุญาตให้เว็บเก็บข้อมูลในเครื่อง');
    return fn(selected.impl);
  });
}

export const db = {
  get: (store, id) => use((b) => b.get(store, id)),
  getAll: (store) => use((b) => b.getAll(store)),
  getAllByIndex: (store, index, value) => use((b) => b.getAllByIndex(store, index, value)),
  put: (store, value) => use((b) => b.put(store, value)),
  putMany: (store, values) => use((b) => b.putMany(store, values)),
  delete: (store, id) => use((b) => b.delete(store, id)),
  /** ลบชุดข้อสอบพร้อมผลตรวจและรูปทั้งหมด */
  deleteExamCascade: (examId) => use((b) => b.deleteExamCascade(examId)),
  /** ลบผลตรวจหนึ่งรายการพร้อมรูป */
  deleteResult: (result) => use((b) => b.deleteResult(result)),
  /** ขนาดรูปทั้งหมด [{ id, size }] */
  blobSizes: () => use((b) => b.blobSizes()),
  /** อ่านทุกอย่างสำหรับไฟล์สำรอง */
  dumpAll: () => use((b) => b.dumpAll()),
};
