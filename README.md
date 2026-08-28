# psd2desc

将 PSD / PSB 解析为 UI 描述 JSON、图层 PNG、HTML 预览，并可进一步转为 Cocos Creator **2.4.13** / **3.8.8** Prefab。

| 脚本 | 作用 |
| --- | --- |
| `psd2desc.js` | PSD/PSB → `ui_desc.json` + PNG |
| `desc2html.js` | 单独为已有导出目录生成/刷新 `index.html` |
| `desc2cocos.js` | `ui_desc.json` → `.prefab`（2.x / 3.x） |

## 环境

- Node.js（建议 18+）

```bash
npm install
```

## 快速开始

```bash
# 1. 解析 PSD/PSB，生成 JSON、PNG、HTML
node psd2desc.js bingoRule.psb

# 2. 把 PNG 复制到 Cocos 工程 assets 下，由编辑器 import 生成 .meta
#    （路径需与 ui_desc.json 中 spriteFramePath 一致，默认 psd_out/）

# 3. 生成 Prefab（CC 2.4.13）
node desc2cocos.js \
  --in psd_export/bingoRule/0/ui_desc.json \
  --out D:/Game/assets/prefabs/bingoRule.prefab \
  --cc 2 \
  --assets D:/Game/assets

# 4. 生成 Prefab（CC 3.8.8）
node desc2cocos.js \
  --in psd_export/bingoRule/0/ui_desc.json \
  --out D:/Game/assets/prefabs/bingoRule.prefab \
  --cc 3 \
  --assets D:/Game/assets
```

npm scripts：

```bash
npm start              # node psd2desc.js
npm run html -- psd_export/bingoRule/0   # 单独生成 HTML 预览
npm run coco -- --in ... --out ... --cc 2 --assets ...
npm run test:coco      # 本地结构校验 + bingoRule 端到端测试
```

## 目录约定

```text
psd2desc/
├── psd/                          # 默认 PSD/PSB 存放目录
│   └── bingoRule.psb
├── psd_export/                   # 导出根目录
│   └── bingoRule/
│       ├── 0/                    # 第 1 次导出
│       │   ├── ui_desc.json
│       │   ├── index.html
│       │   └── *.png
│       └── 1/                    # 第 2 次导出，依此类推
├── config/
│   └── font-map.json             # PSD 字体名 → Cocos TTF 路径
├── lib/                          # desc2cocos 内部模块
├── templates/                    # prefab 格式参考 fixture
├── test/                         # desc2cocos 验证脚本与 fixture
├── psd2desc.js
├── desc2html.js
└── desc2cocos.js
```

每次完整导出都会在 `psd_export/<文件名>/` 下新建递增数字目录（已有 `0` 则创建 `1`），不会覆盖历史结果。

---

## psd2desc.js

### 命令

```bash
# 完整导出：解析 PSD/PSB，生成 JSON、PNG、HTML
node psd2desc.js bingoRule.psb

# 同样完整导出，并强制写出 HTML 预览
node psd2desc.js --html bingoRule.psb
```

文件参数解析顺序：

1. 当前工作目录下的路径（相对或绝对）
2. `./psd/` 目录下的同名文件

未传文件时直接报错。

### 配置

文件顶部配置区：

| 常量 | 默认值 | 说明 |
| --- | --- | --- |
| `PSD_DIR` | `./psd` | 未写完整路径时的默认查找目录 |
| `EXPORT_ROOT` | `./psd_export` | 导出根目录 |
| `RESOURCES_SUB_PATH` | `psd_out` | JSON 里 `spriteFramePath` 的 resources 子路径 |
| `EXPORT_PNG` | `true` | 是否写出图层 PNG |
| `EXPORT_HTML` | `true` | 是否写出预览页 |
| `TRIM_TRANSPARENT` | `true` | 是否裁掉图层透明边 |
| `TRIM_ALPHA_MIN` | `1` | 裁边时视为不透明的最小 alpha |

`spriteFramePath` 形如 `psd_out/图层名.png`，对应 Cocos 中 `assets/resources/psd_out/`（或你自定义的 assets 子路径）。

### 处理流程

```text
读取 PSD/PSB
  → 解析图层记录（含组、蒙版、文字）
  → 隐藏组内的所有子图层一并标记为隐藏
  → 收集祖先组的图层蒙版
  → 解码通道像素、合成 RGBA、应用自身蒙版与组蒙版
  → 裁透明边并修正 left/top/width/height
  → 按图层组还原节点树
  → 组包围盒取子节点并集
  → 坐标从 PSD 左上原点转为 Cocos 左下原点
  → 写出 ui_desc.json、PNG、index.html
```

### PSD 图层约定

- **隐藏图层**：不进入 JSON；隐藏组内的子图层同样跳过。
- **组蒙版**：组上的图层蒙版会裁剪组内所有子图层，导出尺寸按裁剪后的可见像素计算。
- **空像素图层**：无有效宽高且不是文字时跳过。
- **图层组**：JSON `type` 为 `group`。
- **组名含 `#raster#`**：整组当作一张图，不递归子节点，也不由脚本导出 PNG。需要在 PS 中盖印后，把 `<组名>.png` 放到 Cocos 资源目录。
- **文字图层**：JSON `type` 为 `label`，带 `text`、`fontSize`、`lineHeight`、`color`、`fontFamily` 等。
- **普通像素图层**：JSON `type` 为 `sprite`，并导出同名 PNG。
- **重名**：节点名在同级自动加后缀 `_2`、`_3`…；PNG 文件名在整个导出目录内全局去重。

### JSON 结构

根节点以源文件名命名，宽高为画布尺寸，`x/y` 为 `0`。

```json
{
  "name": "bingoRule",
  "visible": true,
  "opacity": 1,
  "x": 0,
  "y": 0,
  "width": 1920,
  "height": 1080,
  "type": "node",
  "children": []
}
```

子节点公共字段：`name`、`visible`、`opacity`、`x`、`y`、`width`、`height`、`type`、`children`。

| type | 额外字段 |
| --- | --- |
| `node` / `group` | `children` |
| `sprite` | `spriteFramePath` |
| `label` | `text`、`fontSize`、`lineHeight`、`color`（`[r,g,b,a]`）、`fontFamily`，可选 `bold`、`paragraph`、`effects` |

坐标说明：

- PSD：原点在画布左上，`top` 向下增大。
- JSON：原点在画布左下，`y` 向上增大。
- 转换：`y = docHeight - psdTop - layerHeight`。
- JSON 中 `x/y` 为**文档绝对坐标**（左下角锚点语义），desc2cocos 会转为相对父节点的局部坐标。

---

## desc2html.js

为已有导出目录单独生成或刷新 `index.html` 预览：

```bash
node desc2html.js psd_export/bingoRule/0
```

页面支持适应窗口 / 100% 缩放，以及描边显示（区分 sprite / label / 其它节点）。

---

## desc2cocos.js

纯 Node 脚本，将 `ui_desc.json` 转为 Cocos Creator Prefab JSON，支持 **2.4.13**（`--cc 2`）和 **3.8.8**（`--cc 3`）。

### 命令

```bash
node desc2cocos.js \
  --in <ui_desc.json> \
  --out <输出.prefab> \
  --cc <2|3> \
  --assets <Cocos工程assets目录>
```

| 参数 | 说明 |
| --- | --- |
| `--in` | `ui_desc.json` 路径（必填） |
| `--out` | 输出 `.prefab` 路径（必填） |
| `--cc` | `2`（2.4.13）或 `3`（3.8.8）（必填） |
| `--assets` | Cocos 工程 `assets/` 根目录（必填） |
| `--font-map` | 字体映射 JSON，默认 `config/font-map.json` |
| `--allow-missing` | 缺少 SpriteFrame meta 时仍输出（默认缺失则失败） |

输出文件：

- `<out>.prefab` — prefab 序列化 JSON
- `<out>.prefab.meta` — 自动生成的 meta（含新 UUID）

### 数据流

```text
ui_desc.json
  → lib/desc-ir.js（相对坐标、子节点 reverse、IR 中间树）
  → lib/meta-resolver.js（从 assets/*.meta 读取 SpriteFrame / Font UUID）
  → lib/emit-2x.js 或 lib/emit-3x.js（版本序列化）
  → .prefab + .prefab.meta
```

### 节点映射

| ui_desc.type | Cocos 2.x | Cocos 3.x |
| --- | --- | --- |
| `node` / `group` | `cc.Node` | `cc.Node` + `cc.UITransform` + `cc.UIOpacity` |
| `sprite` | `cc.Sprite` | `cc.Sprite` |
| `label` | `cc.Label`（+ 可选 `cc.LabelOutline`） | 同左 |

坐标策略：统一锚点 `(0, 0)`（左下角），子节点位置 = 绝对坐标减去父节点绝对坐标，与 HTML 预览一致。

### 资源 UUID

脚本**不会**凭空生成 SpriteFrame UUID，必须从 Cocos 已 import 资源的 `.meta` 读取：

- **PNG**：读取 `{assets}/{spriteFramePath}.meta`，从 `subMetas[文件名].uuid` 取 SpriteFrame UUID
- **字体**：见下方 `font-map.json`；未映射的字体使用引擎默认字体

**前置条件**：PNG 必须先复制到 Cocos `assets/` 并由编辑器 import 一次。

### 字体映射（config/font-map.json）

PSD 中的 `fontFamily` 与 Cocos TTF 资源不会自动对应，需手动配置：

```json
{
  "MicrosoftYaHei-Bold": "fonts/msyhbd.ttf",
  "AdobeHeitiStd-Regular": "fonts/adobehei.ttf"
}
```

键为 ui_desc 中的 `fontFamily`，值为相对于 `--assets` 的 TTF 路径。脚本读取对应 `.meta` 的 `uuid` 写入 Label；未映射则 `_isSystemFontUsed: true`。

### desc2cocos 已知限制

- **渐变描边 / 渐变叠加**等复杂 `effects` 不转换（控制台会 warning），需在 PSD 中栅格化为 sprite
- **纯色描边**转为 `cc.LabelOutline`（2.x / 3.x 均支持）
- **paragraph: true** 的段落文本：`overflow = RESIZE_HEIGHT`，并启用换行
- prefab 在编辑器中若报 UUID 错误，通常是 PNG 未 import 或 `font-map.json` 路径错误
- 建议在编辑器中打开 prefab，与同目录 `index.html` 预览对照位置和层级

---

## 接入 Cocos 完整流程

1. `node psd2desc.js <文件.psb>` 导出 JSON + PNG。
2. 将 PNG 复制到 Cocos `assets/` 下（路径与 `spriteFramePath` 一致，默认 `resources/psd_out/` 或你项目中的对应目录）。
3. 在 Cocos 编辑器中确认资源已 import（每个 PNG 旁有 `.meta`）。
4. `#raster#` 组需手工盖印 PNG，同样 import。
5. 按需编辑 `config/font-map.json`，将 TTF 放入 assets 并 import。
6. 运行 `desc2cocos.js` 生成 prefab 到 `assets/prefabs/` 等目录。
7. 在编辑器中打开 prefab，与同次导出的 `index.html` 核对布局。

---

## 测试

```bash
npm run test:coco
```

校验内容：

- `templates/reference-2x.json` / `reference-3x.json` 结构
- 以 `psd_export/bingoRule/0/ui_desc.json` 生成 2.x / 3.x prefab（需本地存在该导出目录）
- 输出写入 `test/output/`（已 gitignore）

---

## 已知限制（psd2desc）

- 只处理 8 位、RLE / 未压缩通道；其它压缩方式导出为空图。
- 文字信息来自 `TySh` 描述符，一个图层内的多种字号/多色只取主样式段。
- 预览页按 PSD 记录的字体名渲染，本机缺少该字体时会回落到系统字体，字宽会有细微差异。
- 智能对象、效果图层、调整图层不会按 PS 合成结果还原。
- `#raster#` 组不会自动出图，必须手工盖印。
- 大 PSB（成百上千图层）解析和写 PNG 会较慢，属正常现象。
