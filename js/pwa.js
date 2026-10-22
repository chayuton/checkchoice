// การติดตั้งเป็นแอปบนหน้าจอหลัก และการขอพื้นที่เก็บข้อมูลถาวร
export const APP_VERSION = '1.4.0';
export const REPO_URL = 'https://github.com/chayuton/checkchoice';

export const install = { prompt: null, listeners: new Set() };

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  install.prompt = e;
  install.listeners.forEach((fn) => fn());
});

export function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

export function platform() {
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

/** ขอให้เบราว์เซอร์เก็บข้อมูลถาวร (ไม่ลบเมื่อพื้นที่เหลือน้อย) */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      return await navigator.storage.persist();
    }
    return navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  } catch (e) {
    return false;
  }
}
