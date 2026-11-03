# 艺术二维码生成器 · QR Art Studio

一个**纯静态、零后端、本地运行**的艺术二维码生成网页。灵感来自 [amazing-qr](https://github.com/x-hw/amazing-qr) 的「艺术融合」思路，但去掉了命令行与 PIL 依赖，直接用浏览器生成。

- 🖼️ 支持背景图融合（只覆盖非保留模块，保证可扫）
- 🎨 彩色 / 灰度两种艺术模式
- 🔤 支持中文等多语言（UTF-8）
- 🔒 全程本地，图片不上传服务器
- 📦 单文件可部署，双击 `index.html` 即用

## 原理（与 amazing-qr 的对应关系）

| amazing-qr (Python) | 本仓库 (Web) |
| --- | --- |
| `mylibs/`（ECC、矩阵、掩码…） | `js/qrcode.min.js`（vendoring 的 [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)，MIT） |
| `amzqr.py::combine` 的艺术融合层 | `js/qr-art.js` 的 `isReserved()` + `render()` |
| PIL `Image` 画像素 | Canvas 2D |

核心思想：二维码的「功能图案」（三个定位角、定时线、对齐图案）必须完整保留；其余数据模块只保留**中心点**作为二维码色，其余区域透出背景图。这样既能呈现图片，扫码设备仍能识别。

## 本地使用

直接双击 `index.html` 即可。或在目录下起一个静态服务器：

```bash
python -m http.server 8000
# 打开 http://localhost:8000
```

> 注：本机 8000 端口可能被其他服务占用，可换端口（如 `python -m http.server 8123`）。

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
│   └── qr-art.js     # 艺术融合层 + 交互逻辑
└── README.md
```

## 可调参数

- 内容：网址 / 文字 / 任意文本（UTF-8）
- 容错等级：L / M / Q / H
- 版本：自动 或 1–40
- 清晰度：像素/模块（4–20）
- 彩色开关、对比度、亮度（高级）

## License

- 页面与艺术层代码：MIT
- `js/qrcode.min.js`：© Kazuhiko Arase，MIT License
