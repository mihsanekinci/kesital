/**
 * timeUtils.js
 * Video süresi ve zaman damgası formatlama / ayrıştırma yardımcıları.
 * "KesitAl" uygulaması için milisaniye/onluk hassasiyetli zaman yönetimi.
 */

/**
 * Saniyeyi "mm:ss.s" veya saat varsa "hh:mm:ss.s" formatına dönüştürür.
 * @param {number} totalSeconds - Formatlanacak toplam saniye
 * @param {boolean} [includeDecimals=true] - Ondalık hanesini (1 basamak) dahil et
 * @returns {string} Formatlanmış zaman metni (örn. "01:24.5" veya "01:15:30.2")
 */
export function formatTime(totalSeconds, includeDecimals = true) {
  if (totalSeconds === null || totalSeconds === undefined || isNaN(totalSeconds) || totalSeconds < 0) {
    return includeDecimals ? '00:00.0' : '00:00';
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const wholeSeconds = Math.floor(totalSeconds % 60);
  const decimal = Math.floor((totalSeconds % 1) * 10);

  const pad = (num, digits = 2) => String(num).padStart(digits, '0');

  const mm = pad(minutes);
  const ss = pad(wholeSeconds);

  let formatted = '';
  if (hours > 0) {
    formatted = `${pad(hours)}:${mm}:${ss}`;
  } else {
    formatted = `${mm}:${ss}`;
  }

  if (includeDecimals) {
    formatted += `.${decimal}`;
  }

  return formatted;
}

/**
 * Kullanıcı girdisini ("01:15.4", "1:15", "75.4", "01:15:30.5") saniyeye çevirir.
 * @param {string|number} timeString - Çözümlenecek girdi
 * @returns {number|null} Saniye cinsinden değer veya geçersizse null
 */
export function parseTime(timeString) {
  if (typeof timeString === 'number') {
    return isNaN(timeString) || timeString < 0 ? null : timeString;
  }

  if (!timeString || typeof timeString !== 'string') {
    return null;
  }

  const clean = timeString.trim().replace(',', '.');

  // Saf saniye girildiyse (örn. "45.2" veya "120")
  if (/^\d+(\.\d+)?$/.test(clean)) {
    const s = parseFloat(clean);
    return isNaN(s) ? null : s;
  }

  // "mm:ss", "mm:ss.s", "hh:mm:ss", "hh:mm:ss.s"
  const parts = clean.split(':');
  if (parts.length === 2) {
    // mm:ss(.s)
    const m = parseFloat(parts[0]);
    const s = parseFloat(parts[1]);
    if (isNaN(m) || isNaN(s) || m < 0 || s < 0 || s >= 60) return null;
    return m * 60 + s;
  } else if (parts.length === 3) {
    // hh:mm:ss(.s)
    const h = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);
    const s = parseFloat(parts[2]);
    if (isNaN(h) || isNaN(m) || isNaN(s) || h < 0 || m < 0 || m >= 60 || s < 0 || s >= 60) return null;
    return h * 3600 + m * 60 + s;
  }

  return null;
}

/**
 * Bir değeri min ve max aralığında sınırlar.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * İki zaman arasındaki süreyi insancıl dilde özetler (örn: "27.5 saniye" veya "1 dk 15.0 sn")
 * @param {number} seconds
 * @returns {string}
 */
export function formatDurationHuman(seconds) {
  if (isNaN(seconds) || seconds <= 0) return '0 saniye';
  if (seconds < 60) {
    return `${seconds.toFixed(1)} sn`;
  }
  const mins = Math.floor(seconds / 60);
  const remSec = (seconds % 60).toFixed(1);
  return `${mins} dk ${remSec} sn`;
}
