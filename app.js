(() => {
  'use strict';

  const MAX_PIXELS = 25_000_000;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8', { fatal: true });
  const state = {
    embedImage: null,
    decodeImage: null,
    rawImage: null,
    analysisA: null,
    analysisB: null,
    lastStego: null,
    theme: localStorage.getItem('stego-theme') || 'dark'
  };

  document.documentElement.dataset.theme = state.theme;

  function setStatus(id, message = '', kind = '') {
    const el = typeof id === 'string' ? $(`#${id}`) : id;
    if (!el) return;
    el.textContent = message;
    el.className = `inline-status${kind ? ` is-${kind}` : ''}`;
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = busy;
    if (busy) {
      button.dataset.originalLabel = button.querySelector('span')?.textContent || '';
      if (button.querySelector('span')) button.querySelector('span').textContent = label || 'Đang xử lý…';
    } else if (button.dataset.originalLabel && button.querySelector('span')) {
      button.querySelector('span').textContent = button.dataset.originalLabel;
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatNumber(value) { return new Intl.NumberFormat('vi-VN').format(value); }

  function formatPValue(value) {
    if (!Number.isFinite(value)) return '1.000';
    if (value < 0.0001) return '<0.0001';
    return value.toFixed(4);
  }

  function u32be(value) {
    return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
  }

  function readU32be(bytes, offset) {
    return (((bytes[offset] << 24) >>> 0) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  }

  function concatBytes(...arrays) {
    const total = arrays.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(total);
    let cursor = 0;
    arrays.forEach(part => { output.set(part, cursor); cursor += part.length; });
    return output;
  }

  function bytesToBits(bytes) {
    const bits = new Uint8Array(bytes.length * 8);
    for (let i = 0; i < bytes.length; i += 1) {
      for (let bit = 0; bit < 8; bit += 1) bits[i * 8 + bit] = (bytes[i] >>> (7 - bit)) & 1;
    }
    return bits;
  }

  function bitsToBytes(bits) {
    const bytes = new Uint8Array(Math.floor(bits.length / 8));
    for (let i = 0; i < bytes.length; i += 1) {
      let value = 0;
      for (let bit = 0; bit < 8; bit += 1) value = (value << 1) | bits[i * 8 + bit];
      bytes[i] = value;
    }
    return bytes;
  }

  function decodeUtf8(bytes) {
    try { return dec.decode(bytes); }
    catch { throw new Error('Payload không phải UTF-8 hợp lệ hoặc ảnh đã hỏng.'); }
  }

  function slotOffset(slot) {
    return Math.floor(slot / 3) * 4 + (slot % 3);
  }

  function writeBit(data, slot, bit) {
    const offset = slotOffset(slot);
    data[offset] = (data[offset] & 254) | bit;
  }

  function readBit(data, slot) { return data[slotOffset(slot)] & 1; }

  function readBytesFromSlots(data, slots, byteCount) {
    const bits = new Uint8Array(byteCount * 8);
    for (let i = 0; i < bits.length; i += 1) bits[i] = readBit(data, slots ? slots[i] : i);
    return bitsToBytes(bits);
  }

  function writeBytesAtSlots(data, bytes, slots) {
    const bits = bytesToBits(bytes);
    for (let i = 0; i < bits.length; i += 1) writeBit(data, slots ? slots[i] : i, bits[i]);
  }

  function cloneImageData(data) { return new ImageData(new Uint8ClampedArray(data.data), data.width, data.height); }

  function canvasFromData(data) {
    const canvas = document.createElement('canvas');
    canvas.width = data.width; canvas.height = data.height;
    canvas.getContext('2d', { willReadFrequently: true }).putImageData(data, 0, 0);
    return canvas;
  }

  function paintCanvas(target, data) {
    if (!target || !data) return;
    target.width = data.width; target.height = data.height;
    target.getContext('2d', { willReadFrequently: true }).putImageData(data, 0, 0);
  }

  async function loadImageFile(file) {
    if (!file) throw new Error('Chưa có file ảnh.');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
      await image.decode();
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) throw new Error('Không đọc được kích thước ảnh.');
      if (width * height > MAX_PIXELS) throw new Error(`Ảnh quá lớn (${formatNumber(width * height)} pixel). Giới hạn là 25 megapixel.`);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(image, 0, 0, width, height);
      const coverData = ctx.getImageData(0, 0, width, height);
      return { file, name: file.name, type: file.type || 'unknown', width, height, coverData, canvas };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'EncodingError') throw new Error('Không đọc được ảnh. Hãy thử PNG, JPG hoặc WebP khác.');
      throw error;
    } finally { URL.revokeObjectURL(url); }
  }

  function imageMeta(image) { return `${image.width} × ${image.height} px · ${formatBytes(image.file.size)} · ${image.type.split('/').pop().toUpperCase()}`; }

  function updateReadout(prefix, image, warning = '') {
    const analysisMap = {
      analysisA: { readout: 'analysisReadoutA', name: 'analysisFileNameA', meta: 'analysisFileMetaA' },
      analysisB: { readout: 'analysisReadoutB', name: 'analysisFileNameB', meta: 'analysisFileMetaB' }
    };
    const mapped = analysisMap[prefix];
    const readout = mapped ? $(`#${mapped.readout}`) : $(`#${prefix}FileReadout`);
    if (!readout || !image) return;
    readout.classList.remove('is-hidden');
    const name = mapped ? $(`#${mapped.name}`) : $(`#${prefix}FileName`);
    const meta = mapped ? $(`#${mapped.meta}`) : $(`#${prefix}FileMeta`);
    if (name) name.textContent = image.name;
    if (meta) meta.textContent = imageMeta(image);
    const stateEl = $(`#${prefix}FileState`);
    if (stateEl) { stateEl.textContent = warning ? 'CHECK' : 'READY'; stateEl.style.color = warning ? 'var(--amber)' : ''; }
    if (warning) setStatus(`${prefix}Status`, warning, '');
  }

  function capacityFor(image) { return Math.floor((image.width * image.height * 3) / 8); }

  function updateCapacityDisplay() {
    const image = state.embedImage;
    if (!image) { $('#embedCapacity').textContent = 'Chưa có ảnh · dung lượng chưa xác định'; return; }
    const mode = $('input[name="mode"]:checked')?.value || 'standard';
    const overhead = mode === 'standard' ? 6 : 9;
    const usableSlots = Math.max(0, image.width * image.height * 3 - overhead * 8);
    $('#embedCapacity').textContent = `Payload dùng được: ${formatBytes(Math.floor(usableSlots / 8))} · header ${overhead} B · ${formatNumber(usableSlots)} slots`;
  }

  function warningForFile(file) {
    return /jpe?g/i.test(file?.name || '') || /jpe?g/i.test(file?.type || '')
      ? 'Cảnh báo: JPG/JPEG thường bị nén. Hãy giữ ảnh PNG sau khi nhúng và gửi dưới dạng file.' : '';
  }

  function setupDropzone(zoneId, inputId, onFile) {
    const zone = $(`#${zoneId}`); const input = $(`#${inputId}`);
    if (!zone || !input) return;
    zone.addEventListener('click', event => { if (!event.target.closest('button')) input.click(); });
    zone.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button')) { event.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); });
    ['dragenter', 'dragover'].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.add('is-dragover'); }));
    ['dragleave', 'drop'].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.remove('is-dragover'); }));
    zone.addEventListener('drop', event => { if (event.dataTransfer.files[0]) onFile(event.dataTransfer.files[0]); });
  }

  async function pickImage(file, target, prefix) {
    const statusMap = { embed: 'embedStatus', decode: 'decodeStatus', raw: 'rawStatus', analysisA: 'analysisStatus', analysisB: 'analysisStatus' };
    try {
      setStatus(statusMap[target] || 'embedStatus', 'Đang đọc ảnh và composite nền trong suốt…', 'busy');
      const image = await loadImageFile(file);
      state[target] = image;
      const readoutKey = target === 'analysisA' ? 'analysisA' : target === 'analysisB' ? 'analysisB' : prefix;
      updateReadout(readoutKey, image, warningForFile(file));
      if (target === 'embedImage') {
        updateCapacityDisplay();
      }
      setStatus(statusMap[target] || 'embedStatus', warningForFile(file) || 'Ảnh đã sẵn sàng. Pixel alpha được đặt trên nền trắng.', warningForFile(file) ? '' : 'success');
    } catch (error) {
      state[target] = null;
      setStatus(statusMap[target] || 'embedStatus', error.message || 'Không đọc được ảnh.', 'error');
    }
  }

  async function sha256(bytes) { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); }

  function mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
      value = (value + 0x6D2B79F5) | 0;
      let t = Math.imul(value ^ (value >>> 15), 1 | value);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  async function sparseSlots(totalSlots, count, password) {
    const digest = await sha256(enc.encode(`${password || ''}|stg`));
    const seed = (((digest[0] << 24) >>> 0) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
    const random = mulberry32(seed);
    const poolSize = totalSlots - 72;
    if (count > poolSize) throw new Error('Payload vượt quá số slot còn lại sau header STG1.');
    const sparse = new Map(); const slots = new Array(count);
    for (let i = 0; i < count; i += 1) {
      const remaining = poolSize - i;
      const chosen = Math.floor(random() * remaining);
      const actual = sparse.has(chosen) ? sparse.get(chosen) : chosen;
      const last = remaining - 1;
      sparse.set(chosen, sparse.has(last) ? sparse.get(last) : last);
      slots[i] = 72 + actual;
    }
    return slots;
  }

  async function deriveKey(password, salt) {
    const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function makeAdvancedPayload(message, password) {
    const plain = enc.encode(message);
    if (!password) return { payload: plain, encrypted: false };
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
    return { payload: concatBytes(salt, iv, cipher), encrypted: true };
  }

  async function embedMessage() {
    const image = state.embedImage;
    const message = $('#messageInput').value;
    const mode = $('input[name="mode"]:checked')?.value || 'standard';
    const password = $('#embedPassword').value;
    const button = $('#embedSubmit');
    if (!image) return setStatus('embedStatus', 'Hãy chọn một ảnh vật mang trước.', 'error');
    if (!message.trim()) return setStatus('embedStatus', 'Tin nhắn đang trống. Hãy nhập ít nhất một ký tự.', 'error');
    setBusy(button, true, mode === 'advanced' && password ? 'Đang mã hóa AES-GCM…' : 'Đang ghi bit vào pixel…');
    setStatus('embedStatus', 'Đang tạo payload và sửa các bit cuối…', 'busy');
    try {
      const totalSlots = image.width * image.height * 3;
      let header; let payload; let slots;
      if (mode === 'standard') {
        payload = enc.encode(message);
        header = concatBytes(enc.encode('CS'), u32be(payload.length));
        const totalBits = (header.length + payload.length) * 8;
        if (totalBits > totalSlots) throw new Error(`Tin nhắn quá dài. Cần ${formatBytes(payload.length)} payload, ảnh chỉ còn ${formatBytes(Math.floor(totalSlots / 8))} tổng dung lượng.`);
        slots = Array.from({ length: payload.length * 8 }, (_, index) => 48 + index);
      } else {
        const advanced = await makeAdvancedPayload(message, password);
        payload = advanced.payload;
        header = concatBytes(enc.encode('STG1'), new Uint8Array([advanced.encrypted ? 1 : 0]), u32be(payload.length));
        const totalBits = 72 + payload.length * 8;
        if (totalBits > totalSlots) throw new Error(`Tin nhắn quá dài cho chế độ Nâng cao. Payload cần ${formatBytes(payload.length)}; ảnh không đủ slot.`);
        slots = await sparseSlots(totalSlots, payload.length * 8, password);
      }
      const stegoData = cloneImageData(image.coverData);
      writeBytesAtSlots(stegoData.data, header, null);
      writeBytesAtSlots(stegoData.data, payload, slots);
      const metrics = computeMetrics(image.coverData.data, stegoData.data);
      const baseName = image.name.replace(/\.[^.]+$/, '') || 'stego';
      state.lastStego = { image, stegoData, mode, payload, password, metrics };
      paintCanvas($('#coverCanvas'), image.coverData); paintCanvas($('#stegoCanvas'), stegoData);
      paintCanvas($('#diffCanvas'), makeDiffData(image.coverData, stegoData)); paintCanvas($('#lsbCanvas'), makeLsbData(stegoData));
      $('#resultPsnr').textContent = metrics.psnr === Infinity ? '∞ dB' : `${metrics.psnr.toFixed(2)} dB`;
      $('#resultMse').textContent = metrics.mse.toFixed(5);
      $('#resultChanged').textContent = formatNumber(metrics.changedPixels);
      $('#resultPayload').textContent = formatBytes(payload.length);
      $('#resultMode').textContent = mode === 'standard' ? 'CS · tuần tự' : password ? 'STG1 · AES + rải bit' : 'STG1 · rải bit';
      const download = $('#downloadStego');
      download.href = canvasFromData(stegoData).toDataURL('image/png'); download.download = `stegolab-${baseName}.png`;
      $('#embedResults').classList.remove('is-hidden');
      setStatus('embedStatus', `Đã nhúng ${formatBytes(payload.length)} vào ${formatNumber(metrics.changedPixels)} pixel.`, 'success');
      $('#embedResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { setStatus('embedStatus', error.message || 'Không thể nhúng tin.', 'error'); }
    finally { setBusy(button, false); }
  }

  function computeMetrics(cover, stego) {
    let sum = 0; let changedPixels = 0; const samples = cover.length / 4 * 3;
    for (let i = 0; i < cover.length; i += 4) {
      let changed = false;
      for (let channel = 0; channel < 3; channel += 1) { const diff = stego[i + channel] - cover[i + channel]; sum += diff * diff; if (diff !== 0) changed = true; }
      if (changed) changedPixels += 1;
    }
    const mse = sum / samples;
    return { mse, changedPixels, psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse) };
  }

  function makeDiffData(cover, stego) {
    const output = new ImageData(cover.width, cover.height);
    for (let i = 0; i < cover.data.length; i += 4) {
      output.data[i] = Math.min(255, Math.abs(stego.data[i] - cover.data[i]) * 12);
      output.data[i + 1] = Math.min(255, Math.abs(stego.data[i + 1] - cover.data[i + 1]) * 12);
      output.data[i + 2] = Math.min(255, Math.abs(stego.data[i + 2] - cover.data[i + 2]) * 12);
      output.data[i + 3] = 255;
    }
    return output;
  }

  function makeLsbData(imageData) {
    const output = new ImageData(imageData.width, imageData.height);
    for (let i = 0; i < imageData.data.length; i += 4) {
      output.data[i] = (imageData.data[i] & 1) * 255; output.data[i + 1] = (imageData.data[i + 1] & 1) * 255; output.data[i + 2] = (imageData.data[i + 2] & 1) * 255; output.data[i + 3] = 255;
    }
    return output;
  }

  async function decodeMessage() {
    const image = state.decodeImage; const password = $('#decodePassword').value; const button = $('#decodeSubmit');
    if (!image) return setStatus('decodeStatus', 'Hãy chọn ảnh cần giải mã trước.', 'error');
    setBusy(button, true, 'Đang đọc pixel…'); setStatus('decodeStatus', 'Đang nhận dạng header và đọc payload…', 'busy');
    try {
      const result = await decodeImageData(image.coverData, password);
      $('#decodedMessage').textContent = result.message;
      $('#decodeModeTag').textContent = result.mode === 'standard' ? 'CS / CHUẨN' : result.encrypted ? 'STG1 / AES-256-GCM' : 'STG1 / SCATTER';
      $('#decodeMeta').textContent = `${formatBytes(result.payloadLength)} payload · đọc trực tiếp từ ${formatNumber(image.width * image.height * 3)} slots · UTF-8`;
      $('#decodeResult').classList.remove('is-hidden');
      setStatus('decodeStatus', 'Đã đọc thành công. Tin nhắn không được gửi đi đâu cả.', 'success');
      $('#decodeResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { $('#decodeResult').classList.add('is-hidden'); setStatus('decodeStatus', error.message || 'Không thể giải mã ảnh này.', 'error'); }
    finally { setBusy(button, false); }
  }

  async function decodeImageData(imageData, password) {
    const totalSlots = imageData.width * imageData.height * 3;
    if (totalSlots < 48) throw new Error('Ảnh quá nhỏ để chứa header CS.');
    const first6 = readBytesFromSlots(imageData.data, null, 6);
    const magic = String.fromCharCode(first6[0], first6[1]);
    if (magic === 'CS') {
      const payloadLength = readU32be(first6, 2);
      if (payloadLength > Math.floor((totalSlots - 48) / 8)) throw new Error('Header CS báo dung lượng không hợp lệ hoặc ảnh đã hỏng.');
      const payload = readBytesFromSlots(imageData.data, null, payloadLength + 6).slice(6);
      return { mode: 'standard', encrypted: false, payloadLength, message: decodeUtf8(payload) };
    }
    if (totalSlots < 72) throw new Error('Ảnh quá nhỏ để chứa header STG1.');
    const first9 = readBytesFromSlots(imageData.data, null, 9);
    if (String.fromCharCode(...first9.slice(0, 4)) !== 'STG1') throw new Error('Không tìm thấy header CS hoặc STG1. Ảnh có thể chưa được nhúng hoặc đã bị nén.');
    if (first9[4] !== 0 && first9[4] !== 1) throw new Error('Header STG1 không hợp lệ: cờ mã hóa không được nhận dạng.');
    const encrypted = first9[4] === 1; const payloadLength = readU32be(first9, 5); const payloadBits = payloadLength * 8;
    if (72 + payloadBits > totalSlots) throw new Error('Header STG1 báo payload vượt quá kích thước ảnh.');
    const slots = await sparseSlots(totalSlots, payloadBits, password || '');
    const payload = readBytesFromSlots(imageData.data, slots, payloadLength);
    if (!encrypted) return { mode: 'advanced', encrypted: false, payloadLength, message: decodeUtf8(payload) };
    if (!password) throw new Error('Ảnh này yêu cầu mật khẩu để giải mã.');
    if (payload.length < 28) throw new Error('Payload mã hóa không hợp lệ.');
    try {
      const salt = payload.slice(0, 16); const iv = payload.slice(16, 28); const cipher = payload.slice(28); const key = await deriveKey(password, salt);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher));
      return { mode: 'advanced', encrypted: true, payloadLength, message: decodeUtf8(plain) };
    } catch { throw new Error('Mật khẩu không đúng hoặc ảnh đã bị thay đổi. AES-GCM không thể xác thực payload.'); }
  }

  function renderRawResult(image) {
    const totalBytes = Math.floor((image.width * image.height * 3) / 8);
    const previewBytes = Math.min(totalBytes, 4096);
    const bytes = readBytesFromSlots(image.coverData.data, null, previewBytes);
    const hexLines = [];
    for (let i = 0; i < bytes.length; i += 16) hexLines.push(`${i.toString(16).padStart(4, '0')}  ${[...bytes.slice(i, i + 16)].map(v => v.toString(16).padStart(2, '0')).join(' ')}`);
    const printable = [...bytes].map(value => value >= 32 && value <= 126 ? String.fromCharCode(value) : (value === 10 || value === 13 || value === 9 ? String.fromCharCode(value) : '·')).join('');
    $('#rawHex').textContent = hexLines.join('\n') || '(không có byte)'; $('#rawChars').textContent = printable || '(không có ký tự đọc được)';
    $('#rawMeta').textContent = `Đã quét ${formatNumber(previewBytes)} / ${formatNumber(totalBytes)} byte khả dụng · ${formatNumber(image.width * image.height * 3)} slot · thứ tự R → G → B, MSB-first`;
    paintCanvas($('#rawPlaneCanvas'), makeLsbData(image.coverData)); $('#rawResult').classList.remove('is-hidden');
  }

  function gammaln(value) {
    const coefficients = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
    let x = value; let y = x; let tmp = x + 5.5; tmp -= (x + .5) * Math.log(tmp); let ser = 1.000000000190015;
    for (let j = 0; j < coefficients.length; j += 1) { y += 1; ser += coefficients[j] / y; }
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  function gammaQ(a, x) {
    if (x < 0 || a <= 0) return 1;
    if (x === 0) return 1;
    if (x < a + 1) {
      let sum = 1 / a; let term = sum;
      for (let n = 1; n <= 200; n += 1) { term *= x / (a + n); sum += term; if (Math.abs(term) < Math.abs(sum) * 3e-7) break; }
      return Math.max(0, 1 - sum * Math.exp(-x + a * Math.log(x) - gammaln(a)));
    }
    let b = x + 1 - a; let c = 1 / 1e-30; let d = 1 / b; let h = d;
    for (let i = 1; i <= 200; i += 1) {
      const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-30) d = 1e-30; c = b + an / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; const delta = d * c; h *= delta; if (Math.abs(delta - 1) < 3e-7) break;
    }
    return Math.min(1, Math.max(0, Math.exp(-x + a * Math.log(x) - gammaln(a)) * h));
  }

  function chiSquare(imageData) {
    const counts = Array.from({ length: 128 }, () => [0, 0]);
    for (let i = 0; i < imageData.data.length; i += 4) for (let channel = 0; channel < 3; channel += 1) {
      const value = imageData.data[i + channel]; counts[Math.floor(value / 2)][value % 2] += 1;
    }
    let statistic = 0; let nonEmpty = 0;
    counts.forEach(([even, odd]) => { if (even + odd) { nonEmpty += 1; const expected = (even + odd) / 2; statistic += ((even - expected) ** 2) / expected + ((odd - expected) ** 2) / expected; } });
    const df = Math.max(1, nonEmpty - 1); const pValue = gammaQ(df / 2, statistic / 2);
    return { counts, statistic, df, pValue, samples: imageData.width * imageData.height * 3 };
  }

  function verdict(p) {
    if (p >= .8) return 'p-value cao · đáng chú ý';
    if (p >= .2) return 'vùng chưa kết luận';
    return 'p-value thấp · ít tín hiệu';
  }

  function drawAnalysisChart(resultA, resultB) {
    const canvas = $('#analysisChart'); const ctx = canvas.getContext('2d'); const width = canvas.width; const height = canvas.height;
    ctx.clearRect(0, 0, width, height); ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-deep'); ctx.fillRect(0, 0, width, height);
    const max = Math.max(1, ...resultA.counts.slice(0, 64).flat()); const barWidth = width / 64;
    resultA.counts.slice(0, 64).forEach(([even, odd], index) => { const x = index * barWidth; const h0 = (even / max) * (height - 34); const h1 = (odd / max) * (height - 34); ctx.fillStyle = '#61e7e1'; ctx.fillRect(x + 1, height - 18 - h0, barWidth * .38, h0); ctx.fillStyle = '#b7e86c'; ctx.fillRect(x + barWidth * .44, height - 18 - h1, barWidth * .38, h1); });
    if (resultB) { ctx.globalAlpha = .28; ctx.strokeStyle = '#ff8777'; ctx.lineWidth = 1; resultB.counts.slice(0, 64).forEach(([even, odd], index) => { const x = index * barWidth + barWidth * .5; const y = height - 18 - ((even + odd) / 2 / max) * (height - 34); ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3); ctx.stroke(); }); ctx.globalAlpha = 1; }
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted-2'); ctx.font = '10px IBM Plex Mono, monospace'; ctx.fillText('cặp giá trị 0 → 126', 10, height - 5); ctx.fillStyle = '#61e7e1'; ctx.fillText('■ A', width - 100, 16); if (resultB) { ctx.fillStyle = '#ff8777'; ctx.fillText('— B', width - 55, 16); }
  }

  function runAnalysis() {
    if (!state.analysisA) return setStatus('analysisStatus', 'Hãy chọn ít nhất một ảnh để phân tích.', 'error');
    try {
      const resultA = chiSquare(state.analysisA.coverData); const resultB = state.analysisB ? chiSquare(state.analysisB.coverData) : null;
      $('#analysisPValueA').textContent = formatPValue(resultA.pValue); $('#analysisVerdictA').textContent = verdict(resultA.pValue);
      $('#analysisPValueB').textContent = resultB ? formatPValue(resultB.pValue) : '—'; $('#analysisVerdictB').textContent = resultB ? verdict(resultB.pValue) : 'chưa có ảnh đối chiếu';
      $('#analysisStatistic').textContent = resultA.statistic.toFixed(2); $('#analysisDf').textContent = `χ² · df = ${resultA.df} · ${formatNumber(resultA.samples)} mẫu`;
      drawAnalysisChart(resultA, resultB); $('#analysisFootnote').textContent = resultB ? `A: ${state.analysisA.name} · B: ${state.analysisB.name}. p-value cao hơn không chứng minh chắc chắn có tin ẩn; hãy so sánh cùng kích thước, nguồn ảnh và mức nhúng.` : `Ảnh A: ${state.analysisA.name}. Kết quả là chỉ báo thống kê trên ba kênh RGB, không phải kết luận pháp chứng.`;
      $('#analysisResult').classList.remove('is-hidden'); setStatus('analysisStatus', 'Đã chạy kiểm định trên dữ liệu pixel cục bộ.', 'success'); $('#analysisResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { setStatus('analysisStatus', error.message || 'Không thể phân tích ảnh.', 'error'); }
  }

  function switchTab(tabName) {
    $$('.tab').forEach(tab => tab.classList.toggle('is-active', tab.dataset.tab === tabName));
    $$('.view').forEach(view => view.classList.toggle('is-visible', view.dataset.view === tabName));
    const details = { embed: ['01 / ENCODE', 'Nhúng tin vào ảnh', 'Chọn một ảnh làm vật mang, sau đó ghi một tín hiệu vào bit cuối của pixel.'], decode: ['02 / DECODE', 'Giải mã từ ảnh', 'Header sẽ tự nói cho StegoLab biết ảnh dùng chế độ nào.'], raw: ['03 / INSPECT', 'Raw LSB', 'Đọc thẳng bit cuối của pixel để kiểm chứng độc lập.'], analyze: ['04 / ANALYZE', 'Phân tích chi-square', 'Một phép kiểm định thống kê để nhìn dấu hiệu nhúng quá nhiều.'], learn: ['05 / FIELD NOTES', 'Cách hoạt động', 'Thuật toán, giới hạn và lý do steganography khác watermark bản quyền.'] }[tabName];
    if (details) { $('#viewKicker').textContent = details[0]; $('#viewTitle').textContent = details[1]; $('#viewHint').textContent = details[2]; }
  }

  function bindTheme() {
    $('#themeToggle').addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = state.theme; localStorage.setItem('stego-theme', state.theme); if (state.analysisA) runAnalysis(); });
  }

  function bindEvents() {
    $$('.tab').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
    $$('[data-tab-link]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); switchTab(link.dataset.tabLink); window.scrollTo({ top: document.querySelector('.tabbar').offsetTop - 18, behavior: 'smooth' }); }));
    bindTheme();
    setupDropzone('embedDropzone', 'embedFile', file => pickImage(file, 'embedImage', 'embed'));
    setupDropzone('decodeDropzone', 'decodeFile', file => pickImage(file, 'decodeImage', 'decode'));
    setupDropzone('rawDropzone', 'rawFile', file => pickImage(file, 'rawImage', 'raw'));
    setupDropzone('analysisDropzoneA', 'analysisFileA', file => pickImage(file, 'analysisA', 'analysis'));
    setupDropzone('analysisDropzoneB', 'analysisFileB', file => pickImage(file, 'analysisB', 'analysis'));
    $('#messageInput').addEventListener('input', () => { $('#messageCount').textContent = `${formatNumber([...$('#messageInput').value].length)} ký tự · ${formatBytes(enc.encode($('#messageInput').value).length)}`; });
    $$('input[name="mode"]').forEach(input => input.addEventListener('change', () => { $$('.mode-card').forEach(card => card.classList.toggle('is-selected', card.querySelector('input')?.checked)); $('#advancedFields').classList.toggle('is-hidden', input.value !== 'advanced' || !input.checked); updateCapacityDisplay(); }));
    $$('.reveal-button').forEach(button => button.addEventListener('click', () => { const target = $(`#${button.dataset.target}`); target.type = target.type === 'password' ? 'text' : 'password'; button.textContent = target.type === 'password' ? 'hiện' : 'ẩn'; }));
    $('#embedSubmit').addEventListener('click', embedMessage); $('#decodeSubmit').addEventListener('click', decodeMessage); $('#rawSubmit').addEventListener('click', () => { if (!state.rawImage) return setStatus('rawStatus', 'Hãy chọn ảnh để quét.', 'error'); renderRawResult(state.rawImage); setStatus('rawStatus', 'Đã đọc trực tiếp các bit cuối của ảnh.', 'success'); }); $('#analysisSubmit').addEventListener('click', runAnalysis);
    $('#copyDecoded').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#decodedMessage').textContent); $('#copyDecoded').textContent = 'Đã sao chép ✓'; setTimeout(() => { $('#copyDecoded').innerHTML = 'Sao chép tin nhắn <b>↗</b>'; }, 1600); } catch { setStatus('decodeStatus', 'Trình duyệt không cho phép sao chép tự động; hãy chọn và copy thủ công.', ''); } });
  }

  bindEvents();
})();
