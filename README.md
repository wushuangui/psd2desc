# psd2desc

将 PSD / PSB 解析为 UI 描述 JSON、图层 PNG 和 HTML 预览，供 Cocos 编辑器扩展读取并生成 Prefab。

入口脚本：`psd2desc.js`

## 环境

- Node.js（建议 18+）
- 依赖：`fs-extra`、`pngjs`

```bash
npm install fs-extra pngjs
```

## 命令

```bash
# 完整导出：解析 PSD/PSB，生成 JSON、PNG、HTML
node psd2desc.js bingoRule.psb

# 同样完整导出，并强制写出 HTML 预览
node psd2desc.js --html bingoRule.psb
```

文件参数解析顺序：

1. 当前工作目录下的路径（相对或绝对）
2. `./psd/` 目录下的同名文件

未传文件时直接报错，例如：

```text
请传入 PSD/PSB 文件，例如: node psd2desc.js bingoRule.psb
```

## 目录约定

```text
psd2desc/
├── psd/                          # 默认 PSD/PSB 存放目录
│   └── bingoRule.psb
├── psd_export/                   # 导出根目录
│   └── bingoRule/                # 以源文件名（不含扩展名）建目录
│       ├── 0/                    # 第 1 次导出
│       │   ├── ui_desc.json
│       │   ├── index.html
│       │   └── *.png
│       ├── 1/                    # 第 2 次导出，依此类推
│       └── ...
└── psd2desc.js
```

每次完整导出都会在 `psd_export/<文件名>/` 下新建递增数字目录（已有 `0` 则创建 `1`，依此类推），不会覆盖历史结果。`--html` 只是强制写出预览页，目录规则相同。

## 配置

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

`spriteFramePath` 形如 `psd_out/图层名.png`，对应 Cocos 中 `assets/resources/psd_out/`。

## 处理流程

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

关键函数：

| 函数 | 作用 |
| --- | --- |
| `parsePsd` | 解析 PSD/PSB 二进制（`8BPS`，version 1=PSD，2=PSB） |
| `parseLayerRecord` | 图层记录：尺寸、混合、名称、组标记、文字、蒙版 |
| `hideDescendantsOfHiddenGroups` | 把隐藏组的可见性下传给子图层 |
| `assignAncestorMasks` | 记录祖先组的蒙版，合成时叠加裁剪 |
| `parseTypeToolText` | 文字：取主样式段的字号、行距、颜色、字体名 |
| `prepareLayerImages` | 合成像素并裁透明边 |
| `buildTree` | 按组开始/结束标记还原树 |
| `unionGroupBounds` | 用可见子节点计算组包围盒 |
| `walkLayer` | 生成 JSON 节点，同时导出 PNG |
| `writePreviewHtml` | 写出可浏览器预览的 `index.html` |

## PSD 图层约定

- **隐藏图层**：不进入 JSON；隐藏组内的子图层同样跳过。
- **组蒙版**：组上的图层蒙版会裁剪组内所有子图层，导出尺寸按裁剪后的可见像素计算。
- **空像素图层**：无有效宽高且不是文字时跳过。
- **图层组**：JSON `type` 为 `group`。
- **组名含 `#raster#`**：整组当作一张图，不递归子节点，也不由脚本导出 PNG。需要在 PS 中盖印后，把 `<组名>.png` 放到 `resources/psd_out/`。
- **文字图层**：JSON `type` 为 `label`，带 `text`、`fontSize`、`lineHeight`、`color`、`fontFamily`。字号取自覆盖非空白字符最多的样式段，并乘以图层变换缩放；只有 PSD 里的真实换行才会换行。
- **普通像素图层**：JSON `type` 为 `sprite`，并导出同名 PNG。
- **重名**：节点名在同级自动加后缀 `_2`、`_3`…；PNG 文件名在整个导出目录内全局去重。
- **非法文件名字符** `\ / : * ? " < > |` 会替换为 `_`。

## JSON 结构

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

按 `type` 额外字段：

| type | 额外字段 |
| --- | --- |
| `node` / `group` | `children` |
| `sprite` | `spriteFramePath` |
| `label` | `text`、`fontSize`、`lineHeight`、`color`（`[r,g,b,a]`，0–255）、`fontFamily`，粗体时附带 `bold` |

坐标说明：

- PSD：原点在画布左上，`top` 向下增大。
- JSON：原点在画布左下，`y` 向上增大。
- 转换：`y = docHeight - psdTop - layerHeight`。

## 接入 Cocos

1. 执行 `node psd2desc.js <文件.psb>`。
2. 把本次导出目录中的 PNG 复制到 `assets/resources/psd_out/`。
3. `#raster#` 组需要手工盖印 PNG，同样放到该目录。
4. 用编辑器扩展 `main.ts` 读取本次目录中的 `ui_desc.json` 生成 Prefab。
5. 浏览器打开同目录 `index.html` 核对层级、位置、透明度和文字。

## HTML 预览

`index.html` 与 PNG、JSON 在同一数字目录。页面支持：

- 适应窗口 / 100% 缩放
- 显示描边（区分 sprite / label / 其它节点）

每次导出都会新建数字目录，已有 `0` 则创建 `1`，依此类推，不会覆盖历史结果。`--html` 会强制写出预览页，导出目录同样递增。

## 已知限制

- 只处理 8 位、RLE / 未压缩通道；其它压缩方式导出为空图。
- 文字信息来自 `TySh` 描述符，一个图层内的多种字号/多色只取主样式段，字距、描边不还原。
- 预览页按 PSD 记录的字体名渲染，本机缺少该字体时会回落到思源黑体 / 微软雅黑，字宽会有细微差异。
- 智能对象、效果图层、调整图层不会按 PS 合成结果还原。
- `#raster#` 组不会自动出图，必须手工盖印。
- 大 PSB（成百上千图层）解析和写 PNG 会较慢，属正常现象。
