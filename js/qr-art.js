/* QR Art Studio
 * 艺术二维码生成器（纯前端）
 *
 * 设计来源：amazing-qr 的「艺术融合」思路——只把背景图覆盖到非保留模块
 * （定位/定时/对齐图案 + 每个模块的中心采样点），从而既好看又能扫。
 *
 * 二维码矩阵内核：qrcode-generator（MIT，已 vendoring 到 js/qrcode.min.js）。
 *   - qrcode(typeNumber, ecl)：typeNumber=0 表示自动选版本
 *   - .addData(str) / .make() / .getModuleCount() / .isDark(r,c)
 *
 * 本文件职责：
 *   1. 调内核算出模块矩阵
 *   2. 自研艺术融合层（reserved 区域 + 中心采样 + 背景图融合）+ Canvas 渲染
 *   3. UI 绑定
 */

// 对齐图案中心坐标表（amazing-qr constant.alig_location，索引 = ver-2）
const ALIG = [
  [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
  [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
  [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
  [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166],
  [6, 30, 58, 86, 114, 142, 170],
];

const QUIET = 4; // 静默区（模块数），符合 QR 规范

/** 格式信息区（format information）模块判定。 */
function isFormatInfo(r, c, n) {
  if (r === 8 && c <= 8 && c !== 6) return true; // 顶左：第8行 0-8 列（跳过定时 col6）
  if (c === 8 && r <= 8 && r !== 6) return true; // 顶左：第8列 0-8 行（跳过定时 row6）
  if (r === 8 && c >= n - 8) return true;        // 顶右：第8行 右 8 列
  if (c === 8 && r >= n - 8) return true;        // 底左：第8列 下 8 行
  return false;
}

/** 版本信息区（version information，ver>6）模块判定。 */
function isVersionInfo(r, c, n) {
  if (r >= n - 11 && r <= n - 9 && c >= 0 && c <= 5) return true; // 顶右 6×3 块
  if (c >= n - 11 && c <= n - 9 && r >= 0 && r <= 5) return true; // 底左 6×3 块
  return false;
}

/** 判断模块 (r,c) 是否属于「保留功能图案」（定位/定时/对齐/格式/版本）。 */
function isReserved(r, c, n, ver) {
  // 三个角的定位图案 + 分隔符（8×8）
  if (r < 8 && c < 8) return true;          // 左上
  if (r < 8 && c >= n - 8) return true;     // 右上
  if (r >= n - 8 && c < 8) return true;     // 左下
  // 定时图案（第 6 行 / 第 6 列）
  if (r === 6 || c === 6) return true;
  // 对齐图案（ver > 1），5×5 块
  if (ver > 1) {
    const loc = ALIG[ver - 2];
    const L = loc.length;
    for (let i = 0; i < L; i++) {
      for (let j = 0; j < L; j++) {
        if ((i === 0 && j === 0) || (i === L - 1 && j === 0) || (i === 0 && j === L - 1)) continue;
        if (Math.abs(r - loc[i]) <= 2 && Math.abs(c - loc[j]) <= 2) return true;
      }
    }
  }
  // 格式信息区、版本信息区、暗模块：必须整体保留，否则扫码器读错
  if (isFormatInfo(r, c, n)) return true;
  if (ver > 6 && isVersionInfo(r, c, n)) return true;
  if (r === 4 * ver + 9 && c === 8) return true; // 固定暗模块
  return false;
}

/** 由模块数推导版本号（qrcode-generator 不暴露 typeNumber）。 */
function versionFromCount(count) {
  return (count - 21) / 4 + 1;
}

/** 生成二维码模块对象。返回 { qr, version, count } 或抛错。 */
function buildMatrix(text, ecl, version) {
  // 支持中文等 UTF-8
  if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  }
  const qr = qrcode(version, ecl);
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  return { qr, version: versionFromCount(count), count };
}

/**
 * 准备背景图层：缩放到刚好覆盖数据区 (n*S × n*S)，居中裁剪，
 * 应用对比度/亮度，并按 colorized 决定是否转灰度。
 */
function prepareBackground(img, n, S, contrast, brightness, colorized) {
  const target = n * S;
  let newW, newH;
  if (img.width <= img.height) {
    newW = target;
    newH = Math.round(img.height * (newW / img.width));
  } else {
    newH = target;
    newW = Math.round(img.width * (newH / img.height));
  }
  const tmp = document.createElement('canvas');
  tmp.width = newW; tmp.height = newH;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(img, 0, 0, newW, newH);

  // 居中裁剪到 target×target
  const crop = document.createElement('canvas');
  crop.width = target; crop.height = target;
  const cctx = crop.getContext('2d');
  const sx = (newW - target) / 2;
  const sy = (newH - target) / 2;
  cctx.drawImage(tmp, sx, sy, target, target, 0, 0, target, target);

  // 应用对比度 + 亮度 + 灰度
  const imgData = cctx.getImageData(0, 0, target, target);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    // 对比度（PIL: (v-0.5)*f+0.5）
    r = (r / 255 - 0.5) * contrast + 0.5;
    g = (g / 255 - 0.5) * contrast + 0.5;
    b = (b / 255 - 0.5) * contrast + 0.5;
    // 亮度
    r *= brightness; g *= brightness; b *= brightness;
    r = Math.max(0, Math.min(255, r * 255));
    g = Math.max(0, Math.min(255, g * 255));
    b = Math.max(0, Math.min(255, b * 255));
    if (!colorized) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = gray;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  cctx.putImageData(imgData, 0, 0);
  return crop;
}

/** 核心渲染：把模块矩阵 + 背景绘制到 canvas。 */
function render(canvas, qr, n, ver, opts) {
  const S = opts.scale;
  const size = (n + 2 * QUIET) * S;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // 白底（静默区）
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  let bg = null;
  if (opts.img) {
    bg = prepareBackground(opts.img, n, S, opts.contrast, opts.brightness, opts.colorized);
  }

  // 先铺背景（数据区），无背景则数据区保持白底
  if (bg) {
    ctx.drawImage(bg, QUIET * S, QUIET * S);
  }

  const darkColor = '#000000';
  const lightColor = '#ffffff';
  const centerLo = Math.floor(S / 3);
  const centerHi = Math.ceil((2 * S) / 3);

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const x = (QUIET + c) * S;
      const y = (QUIET + r) * S;
      const dark = qr.isDark(r, c);
      const fill = dark ? darkColor : lightColor;
      const reserved = isReserved(r, c, n, ver);

      if (!bg) {
        // 无背景：普通二维码，整模块绘制
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, S, S);
      } else if (reserved) {
        // 保留区：整模块画 QR 颜色（覆盖背景）
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, S, S);
      } else {
        // 数据区：仅中心采样点画 QR 颜色，其余保留背景
        ctx.fillStyle = fill;
        ctx.fillRect(x + centerLo, y + centerLo, centerHi - centerLo, centerHi - centerLo);
      }
    }
  }
}

/* ---------------- UI 绑定 ---------------- */

const $ = (id) => document.getElementById(id);

function fillVersionOptions() {
  const sel = $('version');
  for (let v = 1; v <= 40; v++) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = `v${v}`;
    sel.appendChild(o);
  }
}

function updateSliderLabels() {
  $('scaleVal').textContent = $('scale').value;
  $('contrastVal').textContent = parseFloat($('contrast').value).toFixed(1);
  $('brightnessVal').textContent = parseFloat($brightness.value).toFixed(1);
}

let currentCanvas = null; // 供下载使用

function showError(msg) {
  $('errorMsg').textContent = msg || '';
}

function generate() {
  showError('');
  const text = $('text').value.trim();
  if (!text) { showError('请输入要生成二维码的内容'); return; }

  const ecl = $('level').value;
  const version = parseInt($('version').value, 10);
  const scale = parseInt($('scale').value, 10);
  const colorized = $('colorized').checked;
  const contrast = parseFloat($('contrast').value);
  const brightness = parseFloat($('brightness').value);

  let matrix;
  try {
    matrix = buildMatrix(text, ecl, version);
  } catch (e) {
    showError('内容过长或版本不合适：请改用「自动」版本，或降低容错等级。');
    return;
  }
  const { qr, version: realVer, count } = matrix;

  const picImg = $('picPreview').dataset.loaded === '1' ? window.__bgImg : null;

  render($('canvas'), qr, count, realVer, {
    scale,
    img: picImg,
    colorized,
    contrast,
    brightness,
  });

  currentCanvas = $('canvas');
  $('download').disabled = false;
  $('meta').textContent = `版本 ${realVer} · 尺寸 ${count}×${count} 模块 · 容错 ${ecl}`;
}

function setupPicturePreview() {
  const input = $('picture');
  const preview = $('picPreview');
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) {
      preview.hidden = true;
      preview.dataset.loaded = '0';
      window.__bgImg = null;
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        window.__bgImg = img;
        preview.src = ev.target.result;
        preview.hidden = false;
        preview.dataset.loaded = '1';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function download() {
  if (!currentCanvas) return;
  currentCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'qrcode.png';
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

function init() {
  fillVersionOptions();
  updateSliderLabels();

  ['scale', 'contrast', 'brightness'].forEach((id) => {
    $(id).addEventListener('input', updateSliderLabels);
  });

  setupPicturePreview();
  $('generate').addEventListener('click', generate);
  $('download').addEventListener('click', download);

  // 输入变化后自动重生成（防抖）
  let t;
  const autoInputs = ['text', 'level', 'version', 'scale', 'colorized', 'contrast', 'brightness'];
  autoInputs.forEach((id) => {
    $(id).addEventListener('change', () => {
      clearTimeout(t);
      t = setTimeout(generate, 350);
    });
  });
  $('picture').addEventListener('change', () => { clearTimeout(t); t = setTimeout(generate, 400); });

  // 首次生成
  generate();
}

document.addEventListener('DOMContentLoaded', init);
