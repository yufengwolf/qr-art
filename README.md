# 艺术二维码生成器 · QR Art Studio

一个**纯静态、零后端、本地运行**的艺术二维码生成网页。灵感来自 [amazing-qr](https://github.com/x-hw/amazing-qr) 的「艺术融合」思路，但去掉了命令行与 PIL 依赖，直接用浏览器生成。

- 🖼️ 支持背景图融合（只覆盖非保留模块，保证可扫）
- 🎬 **GIF 动态二维码**：上传 GIF 作背景，逐帧渲染后合成为动画二维码（导出 `.gif`）
- 🏷️ **Logo 叠加**：在二维码中心叠加 Logo（白底圆角背板，可调节大小）
- 🎨 彩色 / 灰度两种艺术模式
- 🔤 支持中文等多语言（UTF-8），界面中英文一键切换
- 🔒 全程本地，图片不上传服务器
- 📦 单文件可部署，双击 `index.html` 即用
- 🖼️ **作品展示区**：在页面底部集中展示你的艺术二维码作品（静态 / 动态 GIF / 黑白 / 彩色），由配置数组驱动

## 原理（与 amazing-qr 的对应关系）

| amazing-qr (Python) | 本仓库 (Web) |
| --- | --- |
| `mylibs/`（ECC、矩阵、掩码…） | `js/qrcode.min.js`（vendoring 的 [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)，MIT） |
| `amzqr.py::combine` 的艺术融合层 | `js/qr-art.js` 的 `isReserved()` + `render()` |
| PIL `Image` 画像素 | Canvas 2D |
| （无）GIF 逐帧 | `js/omggif.js` 解码 + `js/gif.js` 编码，逐帧渲染后再合成 |

核心思想：二维码的「功能图案」（三个定位角、定时线、对齐图案、格式/版本信息、暗模块）必须完整保留；其余数据模块只保留**中心点**作为二维码色，其余区域透出背景图。这样既能呈现图片，扫码设备仍能识别。Logo 叠加在中心，靠容错（默认 H，30%）保证仍可扫。

## 本地使用

静态生成（普通 / 背景图 / Logo）直接双击 `index.html` 即可。但 **GIF 动态二维码需要 Web Worker**，必须用本地服务器打开（`file://` 下 Worker 会被浏览器拦截）：

```bash
python -m http.server 8000
# 打开 http://localhost:8000
```

> 注：本机 8000 端口可能被其他服务占用，可换端口（如 `python -m http.server 8123`）。若 GIF 编码报错，请确认是用 `http://` 打开而非双击文件。

## 部署到 Cloudflare Pages

1. 把本目录推到 GitHub 仓库。
2. Cloudflare Pages → Create a project → 连接该仓库。
3. 构建设置：
   - Framework preset：**None**
   - Build command：**留空**
   - Build output directory：`/`（根目录）
4. 部署完成，获得 `*.pages.dev` 域名。

无需任何构建步骤，纯静态托管。

## 文件结构

```
qr-art/
├── index.html        # 页面与 UI
├── css/style.css     # 样式
├── js/
│   ├── qrcode.min.js # 二维码内核（MIT，已内嵌，离线可用）
│   ├── omggif.js     # GIF 解码（MIT，已内嵌）
│   ├── gif.js        # GIF 编码（含 gif.worker.js，MIT，已内嵌）
│   └── qr-art.js     # 艺术融合层 + 交互逻辑
├── showcase/          # 作品展示区图片目录（你生成的二维码放这里）
│   └── .gitkeep
└── README.md
```

## 可调参数

- 内容：网址 / 文字 / 任意文本（UTF-8）
- 背景图：支持 PNG / JPEG / WebP / **GIF**（GIF 自动进入动态模式）
- Logo：可选，居中叠加，大小可调（10%–35%）
- 容错等级：L / M / Q / H（动态/Logo 建议用 H，可扫性更稳）
- 版本：自动 或 1–40
- 清晰度：像素/模块（4–20）
- 彩色开关、对比度、亮度（高级）

## 作品展示区（Gallery）

页面底部有一个「作品展示」区块，用于集中陈列各种风格的艺术二维码（静态图、动态 GIF、黑白、彩色）。**你只需提供图片，无需改任何渲染逻辑**：

1. 把二维码图片放进 `showcase/` 目录（如 `showcase/demo-1.png`、`showcase/demo-2.gif`）。
2. 在 `js/qr-art.js` 顶部的 `SHOWCASE_ITEMS` 数组里登记一项：

```js
{ src: 'showcase/demo-1.png', captionZh: '渐变星空 · 彩色', captionEn: 'Gradient starry · Color', tags: ['color', 'static'] },
```

字段说明：

- `src`：相对 `index.html` 的路径
- `captionZh` / `captionEn`：中 / 英文说明（随语言切换）
- `tags`：`['static' | 'animated']` + `['bw' | 'color']`
  - `animated` 也可由 `.gif` 后缀自动判定
  - 黑白 / 彩色无法自动识别，需手动标注 `bw` / `color`，会显示为角标

图片未找到时，卡片会显示「待添加」占位（带文件名），把对应文件丢进 `showcase/` 即自动显示；数组为空时显示引导文案。

## License

- 页面与艺术层代码：MIT
- `js/qrcode.min.js`：© Kazuhiko Arase，MIT License
- `js/omggif.js`：© Dean McNamee，MIT License
- `js/gif.js` / `js/gif.worker.js`：© jnordberg，MIT License
