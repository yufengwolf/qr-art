/* QR Art Studio
 * 艺术二维码生成器（纯前端，中英文双语）
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
 *   3. i18n + UI 绑定
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
const MAX_BYTES = 1200; // 超出则字节计数变红（仅提示，不拦截）

/**
 * 作品展示区配置 —— 你只需往这里加图片，无需改其它代码。
 * 把二维码图片放到 showcase/ 目录，然后在此登记一项即可：
 *   - src:       相对路径（相对 index.html），如 'showcase/demo-1.png' 或 'showcase/demo-1.gif'
 *   - captionZh: 中文说明
 *   - captionEn: 英文说明
 *   - tags:      ['static' | 'animated'] + ['bw' | 'color']
 *                （animated 也可由 .gif 后缀自动判定；黑白/彩色需手动标注）
 */
const SHOWCASE_ITEMS = [
  { src: 'showcase/demo-1.png', captionZh: '幸福美满 · 彩色', captionEn: 'Happy family · Color', tags: ['color', 'static'] },
  { src: 'showcase/demo-2.gif', captionZh: '流光动画 · 动态', captionEn: 'Flowing light · Animated', tags: ['color', 'animated'] },
  { src: 'showcase/demo-3.png', captionZh: '水墨留白 · 黑白', captionEn: 'Ink minimal · B&W', tags: ['bw', 'static'] },
  { src: 'showcase/demo-4.png', captionZh: '品牌 Logo 叠加', captionEn: 'Logo overlay', tags: ['color', 'static'] },
];

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

  // Logo 叠加（静态 / 动态帧通用）
  if (opts.logo) drawLogo(ctx, size, opts.logoRatio || 0.22, opts.logo);
}

/* ---------------- 动态 GIF / Logo 支持 ---------------- */

/** 把 Logo 居中叠加到二维码上（白底圆角背板 + contain 缩放）。 */
function drawLogo(ctx, size, ratio, logo) {
  const lw = size * ratio;
  const pad = lw * 0.12;
  const box = lw + pad * 2;
  const x = (size - box) / 2;
  const y = (size - box) / 2;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, box, box, box * 0.2);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, box, box);
  }
  const ar = (logo.width && logo.height) ? logo.width / logo.height : 1;
  let dw, dh;
  if (ar >= 1) { dw = lw; dh = lw / ar; } else { dh = lw; dw = lw * ar; }
  ctx.drawImage(logo, (size - dw) / 2, (size - dh) / 2, dw, dh);
  ctx.restore();
}

/**
 * 解码 GIF：返回 [{ canvas, delay }]。
 * - delay 由 GIF 的 1/100 秒单位换算为毫秒，并设最小下限（避免过快/为 0）。
 * - 处理 disposal=2（还原背景）以正确合成逐帧画面；disposal 0/1 视为「保留」。
 */
function decodeGifFrames(buffer) {
  const reader = new GifReader(new Uint8Array(buffer));
  const W = reader.width, H = reader.height;
  const n = reader.numFrames();
  const frames = [];
  const acc = new Uint8ClampedArray(W * H * 4); // 初始全透明
  let prevDisposal = 0, prevRect = null;
  for (let i = 0; i < n; i++) {
    const info = reader.frameInfo(i);
    if (i > 0 && prevDisposal === 2 && prevRect) {
      for (let yy = prevRect.y; yy < prevRect.y + prevRect.height; yy++) {
        const start = (yy * W + prevRect.x) * 4;
        acc.fill(0, start, start + prevRect.width * 4);
      }
    }
    reader.decodeAndBlitFrameRGBA(i, acc);
    const copy = new Uint8ClampedArray(acc);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.getContext('2d').putImageData(new ImageData(copy, W, H), 0, 0);
    let d = info.delay * 10;
    if (d < 30) d = (d === 0 ? 100 : 30);
    frames.push({ canvas: cv, delay: d });
    prevDisposal = info.disposal;
    prevRect = { x: info.x, y: info.y, width: info.width, height: info.height };
  }
  return frames;
}

/** 用 gif.js 把多帧画布合成为动画 GIF 的 Blob。需通过 http 服务器打开（worker 限制）。 */
function encodeAnimatedGif(canvases, delays, size, onDone, onError) {
  let gif;
  try {
    gif = new GIF({ workers: 2, quality: 10, repeat: 0, width: size, height: size, workerScript: 'js/gif.worker.js' });
  } catch (e) { onError && onError(e); return; }
  canvases.forEach((cv, i) => gif.addFrame(cv, { delay: delays[i], copy: true }));
  gif.on('finished', (blob) => onDone(blob));
  gif.on('abort', () => onError && onError(new Error('aborted')));
  try { gif.render(); } catch (e) { onError && onError(e); }
}

function stopAnim() {
  if (animTimer) { clearTimeout(animTimer); animTimer = null; }
}

/** 在预览 canvas 上循环播放逐帧画面（按各帧自身 delay）。 */
function playFrames(canvases, delays) {
  stopAnim();
  const ctx = $('canvas').getContext('2d');
  let i = 0;
  const step = () => {
    ctx.drawImage(canvases[i], 0, 0);
    animTimer = setTimeout(step, delays[i]);
    i = (i + 1) % canvases.length;
  };
  step();
}

/* ---------------- 国际化 (i18n) ---------------- */

const I18N = {
  zh: {
    'title': '艺术二维码生成器 · QR Art Studio',
    'brand': '御风 YUFENG',
    'nav.home': '首页',
    'crumbs': '工具 / QR ART',
    'h1': '艺术二维码生成器',
    'subtitle': '纯静态 · 本地生成 · 不上传任何数据',
    'content.label': '内容（网址 / 文字 / 任意文本）',
    'content.placeholder': 'https://qr-art.pages.dev/ 或 你好世界',
    'content.hint': '内容最多约 500 个汉字；越短越易扫。',
    'quick.link': '链接',
    'quick.wechat': '微信',
    'quick.phone': '电话',
    'quick.email': '邮箱',
    'pic.label': '背景图（可选；支持 GIF 动态二维码）',
    'pic.colorized': '彩色（不勾则为灰度艺术二维码）',
    'logo.label': 'Logo 叠加（可选，居中显示）',
    'logo.ratio': 'Logo 大小：',
    'level.label': '容错等级',
    'level.L': 'L（低 7%）',
    'level.M': 'M（中 15%）',
    'level.Q': 'Q（较高 25%）',
    'level.H': 'H（高 30%）',
    'version.label': '版本',
    'version.auto': '自动',
    'scale.label': '清晰度（像素/模块）：',
    'advanced': '高级：图像调节',
    'contrast.label': '对比度：',
    'brightness.label': '亮度：',
    'generate': '生成',
    'download': '下载 PNG',
    'footer': '全部在浏览器本地完成，图片不会离开你的电脑。',
    'unit.bytes': '字节',
    'err.empty': '请输入要生成二维码的内容',
    'err.tooLong': '内容过长或版本不合适：请改用「自动」版本，或降低容错等级。',
    'status.default': '输入内容后，点击「生成」即可生成二维码。',
    'status.generated': '二维码已生成，可下载 PNG。',
    'status.encoding': '正在合成动画 GIF…',
    'meta.fmt': '版本 {ver} · 尺寸 {count}×{count} 模块 · 容错 {ecl}',
    'meta.anim': '动画 GIF · {n} 帧 · 尺寸 {count}×{count} 模块 · 容错 {ecl}',
    'err.gif': 'GIF 合成失败：请通过本地服务器(http)打开本页，勿用 file://',
    'err.gifdecode': 'GIF 解码失败：',
    'download': '下载 PNG',
    'download.gif': '下载 GIF',
    'lang.toggle': 'EN',
    'nav.gallery': '展示',
    'gallery.crumbs': '案例 / GALLERY',
    'gallery.h1': '作品展示',
    'gallery.subtitle': '各种风格的艺术二维码示例（静态 / 动态 / 黑白 / 彩色）。',
    'gallery.pending': '图片待添加',
    'gallery.pendingHint': '把对应文件放到 showcase/ 目录即可显示。',
    'gallery.tag.animated': '动态',
    'gallery.tag.static': '静态',
    'gallery.tag.bw': '黑白',
    'gallery.tag.color': '彩色',
    'gallery.empty': '展示区待填充',
    'gallery.emptyHint': '在 js/qr-art.js 的 SHOWCASE_ITEMS 中登记你的二维码图片路径即可。',
  },
  en: {
    'title': 'Art QR Generator · QR Art Studio',
    'brand': 'YUFENG',
    'nav.home': 'Home',
    'crumbs': 'TOOL / QR ART',
    'h1': 'Art QR Generator',
    'subtitle': 'Static · Runs locally · No data uploaded',
    'content.label': 'Content (URL / text / anything)',
    'content.placeholder': 'https://qr-art.pages.dev/ or Hello World',
    'content.hint': 'About 500 Chinese chars max; shorter scans better.',
    'quick.link': 'Link',
    'quick.wechat': 'WeChat',
    'quick.phone': 'Phone',
    'quick.email': 'Email',
    'pic.label': 'Background image (optional; GIF → animated QR)',
    'pic.colorized': 'Colorized (grayscale art QR if unchecked)',
    'logo.label': 'Logo overlay (optional, centered)',
    'logo.ratio': 'Logo size: ',
    'level.label': 'Error correction',
    'level.L': 'L (low 7%)',
    'level.M': 'M (medium 15%)',
    'level.Q': 'Q (high 25%)',
    'level.H': 'H (highest 30%)',
    'version.label': 'Version',
    'version.auto': 'Auto',
    'scale.label': 'Resolution (px/module): ',
    'advanced': 'Advanced: image tuning',
    'contrast.label': 'Contrast: ',
    'brightness.label': 'Brightness: ',
    'generate': 'Generate',
    'download': 'Download PNG',
    'footer': 'Everything runs locally in your browser. Images never leave your device.',
    'unit.bytes': 'bytes',
    'err.empty': 'Please enter the content to encode',
    'err.tooLong': 'Content too long or version unsupported: switch to "Auto" or lower error correction.',
    'status.default': 'Enter content, then click "Generate" to create a QR code.',
    'status.generated': 'QR code generated — PNG download ready.',
    'status.encoding': 'Compositing animated GIF…',
    'meta.fmt': 'Version {ver} · {count}×{count} modules · Level {ecl}',
    'meta.anim': 'Animated GIF · {n} frames · {count}×{count} modules · Level {ecl}',
    'err.gif': 'GIF encoding failed: open this page via a local server (http), not file://',
    'err.gifdecode': 'GIF decode failed: ',
    'download': 'Download PNG',
    'download.gif': 'Download GIF',
    'lang.toggle': '中',
    'nav.gallery': 'Gallery',
    'gallery.crumbs': 'CASES / GALLERY',
    'gallery.h1': 'Gallery',
    'gallery.subtitle': 'Art QR examples in various styles (static / animated / B&W / color).',
    'gallery.pending': 'Image pending',
    'gallery.pendingHint': 'Drop the matching file into the showcase/ folder to display it.',
    'gallery.tag.animated': 'Animated',
    'gallery.tag.static': 'Static',
    'gallery.tag.bw': 'B&W',
    'gallery.tag.color': 'Color',
    'gallery.empty': 'Gallery empty',
    'gallery.emptyHint': 'Register your QR image paths in SHOWCASE_ITEMS (js/qr-art.js) to show them here.',
  },
};

let currentLang = 'zh';

function t(key, vars) {
  let s = (I18N[currentLang] && I18N[currentLang][key] != null)
    ? I18N[currentLang][key]
    : (I18N.zh[key] != null ? I18N.zh[key] : key);
  if (vars) {
    for (const k in vars) {
      s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
    }
  }
  return s;
}

function applyLang() {
  document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  const lt = document.getElementById('lang-toggle');
  if (lt) {
    lt.textContent = t('lang.toggle');
    lt.setAttribute('aria-label', t('lang.toggle'));
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
  $('brightnessVal').textContent = parseFloat($('brightness').value).toFixed(1);
  const lr = $('logoRatio');
  if (lr) $('logoRatioVal').textContent = lr.value + '%';
}

function updateContentCount() {
  const bytes = new TextEncoder().encode($('text').value.trim()).length;
  const el = $('contentCount');
  el.textContent = bytes.toLocaleString() + ' ' + t('unit.bytes');
  el.classList.toggle('over-limit', bytes > MAX_BYTES);
}

let currentCanvas = null; // 供下载使用
let currentBlob = null;    // 动画 GIF 的 Blob（静态时为 null，走 currentCanvas）
let currentBlobUrl = null; // 对应 object URL
let currentBlobName = 'qrcode.png';
let animTimer = null;      // 预览播放定时器
let genToken = 0;          // 防止过期的异步编码结果覆盖最新结果

function setStatus(msg, isError) {
  const el = $('status');
  el.textContent = msg || '';
  el.classList.toggle('is-error', !!isError);
}

function generate() {
  setStatus('');
  const text = $('text').value.trim();
  if (!text) { setStatus(t('err.empty'), true); return; }

  const ecl = $('level').value;
  const version = parseInt($('version').value, 10);
  const scale = parseInt($('scale').value, 10);
  const colorized = $('colorized').checked;
  const contrast = parseFloat($('contrast').value);
  const brightness = parseFloat($('brightness').value);
  const logoRatio = parseFloat($('logoRatio').value) / 100;

  let matrix;
  try {
    matrix = buildMatrix(text, ecl, version);
  } catch (e) {
    setStatus(t('err.tooLong'), true);
    return;
  }
  const { qr, version: realVer, count } = matrix;

  const picImg = $('picPreview').dataset.loaded === '1' ? window.__bgImg : null;
  const frames = window.__bgFrames;
  const logo = window.__logoImg;
  const optsBase = { scale, colorized, contrast, brightness, logo, logoRatio };

  const myToken = ++genToken;
  stopAnim();

  if (frames && frames.length > 1) {
    // 动态 GIF 路径：逐帧渲染艺术二维码，再合成为动画 GIF
    const S = scale;
    const size = (count + 2 * QUIET) * S;
    const canvases = [];
    const delays = [];
    for (const f of frames) {
      const cv = document.createElement('canvas');
      render(cv, qr, count, realVer, Object.assign({}, optsBase, { img: f.canvas }));
      canvases.push(cv);
      delays.push(f.delay);
    }
    playFrames(canvases, delays);
    setStatus(t('status.encoding'));
    $('download').textContent = t('download.gif');
    $('download').disabled = true;
    $('meta').textContent = t('meta.anim', { n: canvases.length, count, ecl });
    encodeAnimatedGif(canvases, delays, size, (blob) => {
      if (myToken !== genToken) return; // 已有更新的生成请求，丢弃过期结果
      currentBlob = blob;
      currentBlobName = 'qrcode.gif';
      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = URL.createObjectURL(blob);
      $('download').disabled = false;
      setStatus(t('status.generated'));
    }, (err) => {
      if (myToken !== genToken) return;
      $('download').disabled = true;
      setStatus(t('err.gif') + (err && err.message ? ' (' + err.message + ')' : ''), true);
    });
    return;
  }

  // 静态路径（无背景 / 静态背景图）
  render($('canvas'), qr, count, realVer, Object.assign({}, optsBase, { img: picImg }));
  currentCanvas = $('canvas');
  currentBlob = null;
  if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
  $('download').textContent = t('download');
  $('download').disabled = false;
  $('meta').textContent = t('meta.fmt', { ver: realVer, count, ecl });
  setStatus(t('status.generated'));
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
      window.__bgFrames = null;
      return;
    }
    if (file.type === 'image/gif') {
      // GIF：解码为逐帧画布，>1 帧走动画路径
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const frames = decodeGifFrames(ev.target.result);
          if (frames.length > 1) {
            window.__bgFrames = frames;
            window.__bgImg = null;
          } else {
            window.__bgFrames = null;
            window.__bgImg = frames[0].canvas;
          }
          preview.src = frames[0].canvas.toDataURL();
          preview.hidden = false;
          preview.dataset.loaded = '1';
        } catch (e) {
          setStatus(t('err.gifdecode') + (e && e.message ? e.message : ''), true);
          window.__bgFrames = null;
          window.__bgImg = null;
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }
    // 静态图
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        window.__bgImg = img;
        window.__bgFrames = null;
        preview.src = ev.target.result;
        preview.hidden = false;
        preview.dataset.loaded = '1';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function setupLogoPreview() {
  const input = $('logo');
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) { window.__logoImg = null; return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => { window.__logoImg = img; };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function download() {
  if (currentBlob && currentBlobUrl) {
    const a = document.createElement('a');
    a.href = currentBlobUrl;
    a.download = currentBlobName;
    a.click();
    return;
  }
  if (currentCanvas) {
    currentCanvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = currentBlobName;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }
}

function renderShowcase() {
  const grid = $('showcaseGrid');
  if (!grid) return;

  if (!SHOWCASE_ITEMS || SHOWCASE_ITEMS.length === 0) {
    grid.innerHTML =
      '<div class="showcase-empty">' +
        '<p class="se-title">' + t('gallery.empty') + '</p>' +
        '<p class="se-hint">' + t('gallery.emptyHint') + '</p>' +
      '</div>';
    return;
  }

  grid.innerHTML = '';
  SHOWCASE_ITEMS.forEach((item) => {
    const tags = (item.tags || []).slice();
    const isGif = (item.src || '').toLowerCase().endsWith('.gif') || tags.indexOf('animated') !== -1;
    if (tags.indexOf('animated') === -1 && tags.indexOf('static') === -1) tags.push(isGif ? 'animated' : 'static');

    const card = document.createElement('figure');
    card.className = 'showcase-card';

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = item.captionZh || item.captionEn || 'QR';
    img.src = item.src;
    img.addEventListener('error', () => {
      card.classList.add('is-pending');
      const ph = document.createElement('div');
      ph.className = 'showcase-pending';
      ph.innerHTML =
        '<span class="pending-plus">+</span>' +
        '<span class="pending-title">' + t('gallery.pending') + '</span>' +
        '<code class="pending-src">' + item.src + '</code>' +
        '<span class="pending-hint">' + t('gallery.pendingHint') + '</span>';
      if (img.parentNode) img.parentNode.replaceChild(ph, img);
    });

    const captionText = currentLang === 'zh'
      ? (item.captionZh || item.captionEn || '')
      : (item.captionEn || item.captionZh || '');
    const badges = tags.map((tag) => '<span class="badge badge-' + tag + '">' + t('gallery.tag.' + tag) + '</span>').join('');

    const figcaption = document.createElement('figcaption');
    figcaption.innerHTML = '<div class="badges">' + badges + '</div><p class="cap">' + captionText + '</p>';

    card.appendChild(img);
    card.appendChild(figcaption);
    grid.appendChild(card);
  });
}

let initialized = false;
function init() {
  if (initialized) return; // 幂等保护：避免重复触发导致事件重复绑定
  initialized = true;

  // 主题（与御风站一致：localStorage 记忆，默认深色）
  const root = document.documentElement;
  let savedTheme = null, savedLang = null;
  try { savedTheme = localStorage.getItem('yf-theme'); } catch (e) {}
  if (savedTheme) root.setAttribute('data-theme', savedTheme);
  try { savedLang = localStorage.getItem('yf-lang'); } catch (e) {}
  if (savedLang) currentLang = savedLang;

  applyLang();

  $('theme-toggle').addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('yf-theme', next); } catch (e) {}
  });

  $('lang-toggle').addEventListener('click', () => {
    currentLang = currentLang === 'zh' ? 'en' : 'zh';
    try { localStorage.setItem('yf-lang', currentLang); } catch (e) {}
    applyLang();
    renderShowcase();
    generate(); // 刷新动态文案（状态/版本信息/字节数）
  });

  fillVersionOptions();
  updateSliderLabels();
  updateContentCount();

  ['scale', 'contrast', 'brightness', 'logoRatio'].forEach((id) => {
    $(id).addEventListener('input', updateSliderLabels);
  });

  setupPicturePreview();
  setupLogoPreview();
  $('generate').addEventListener('click', generate);
  $('download').addEventListener('click', download);

  // 快速模板
  document.querySelectorAll('.template-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('text').value = btn.dataset.template;
      updateContentCount();
      generate();
    });
  });

  // 输入变化后自动重生成（防抖）
  let debounceTimer;
  const autoInputs = ['level', 'version', 'scale', 'colorized', 'contrast', 'brightness', 'logoRatio'];
  autoInputs.forEach((id) => {
    $(id).addEventListener('change', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(generate, 350);
    });
  });
  $('text').addEventListener('input', () => {
    updateContentCount();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(generate, 350);
  });
  $('picture').addEventListener('change', () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(generate, 400); });
  $('logo').addEventListener('change', () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(generate, 400); });

  // 作品展示区
  renderShowcase();

  // 首次生成 + 默认提示
  setStatus(t('status.default'));
  generate();
}

document.addEventListener('DOMContentLoaded', init);
