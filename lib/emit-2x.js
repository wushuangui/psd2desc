"use strict";

const { PrefabBuilder } = require("./prefab-builder");

const DEFAULT_UI_MATERIAL_2X = "eca5d2f2-8ef6-41c2-bbe6-a9ac17cabc6b";

function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function numberOr(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function colorOr(value, fallback) {
    const color = value && typeof value === "object" ? value : {};
    return {
        r: numberOr(color.r, fallback.r),
        g: numberOr(color.g, fallback.g),
        b: numberOr(color.b, fallback.b),
        a: numberOr(color.a, fallback.a)
    };
}

function textOrEmpty(value) {
    return value == null ? "" : String(value);
}

function emitLabelOutline2x(b, nodeId, outline) {
    const color = colorOr(outline.color, { r: 0, g: 0, b: 0, a: 255 });
    return b.add({
        __type__: "cc.LabelOutline",
        _name: "",
        _objFlags: 0,
        node: b.ref(nodeId),
        _enabled: true,
        _color: b.color(color.r, color.g, color.b, color.a),
        _width: numberOr(outline.width, 0),
        _id: ""
    });
}

function emitLabelShadow2x(b, nodeId, shadow) {
    const color = colorOr(shadow.color, { r: 0, g: 0, b: 0, a: 255 });
    return b.add({
        __type__: "cc.LabelShadow",
        _name: "",
        _objFlags: 0,
        node: b.ref(nodeId),
        _enabled: true,
        _color: b.color(color.r, color.g, color.b, color.a),
        _offset: b.vec2(numberOr(shadow.offsetX, 0), numberOr(shadow.offsetY, 0)),
        _blur: numberOr(shadow.blur, 0),
        _id: ""
    });
}

function emitSprite2x(b, nodeId, ir, meta) {
    const uuid = meta.spriteFrameUuid(ir.spriteFramePath);
    const compId = b.add({
        __type__: "cc.Sprite",
        _name: "",
        _objFlags: 0,
        node: b.ref(nodeId),
        _enabled: true,
        _materials: [b.uuidRef(DEFAULT_UI_MATERIAL_2X)],
        _srcBlendFactor: 770,
        _dstBlendFactor: 771,
        _spriteFrame: uuid ? b.uuidRef(uuid) : null,
        _type: 0,
        _sizeMode: 1,
        _fillType: 0,
        _fillCenter: b.vec2(0, 0),
        _fillStart: 0,
        _fillRange: 0,
        _isTrimmedMode: true,
        _atlas: null,
        _id: ""
    });
    return compId;
}

function emitLabel2x(b, nodeId, ir, meta, pathKey) {
    const label = ir.label && typeof ir.label === "object" ? ir.label : {};
    const text = textOrEmpty(label.text);
    const hasLineBreak = /\r|\n/.test(text);
    const wrap = hasOwn(label, "wrap") && label.wrap != null
        ? label.wrap === true
        : hasLineBreak;
    const overflow = label.overflow != null ? label.overflow : (wrap ? 1 : 0);
    const horizontalAlign = label.horizontalAlign != null ? label.horizontalAlign : 0;
    const verticalAlign = label.verticalAlign != null ? label.verticalAlign : 1;
    const fontFamily = label.fontFamily != null ? String(label.fontFamily) : "Arial";
    const fontUuid = meta.fontUuid(fontFamily);
    const rgba = colorOr(label.color, { r: 255, g: 255, b: 255, a: 255 });
    const fontSize = numberOr(label.fontSize, 40);
    const actualFontSize = numberOr(label.actualFontSize, fontSize);
    const lineHeight = numberOr(label.lineHeight, fontSize);
    const spacingX = numberOr(
        label.letterSpacing,
        numberOr(label.spacingX, 0)
    );
    const underlineHeight = numberOr(
        label.underlineHeight,
        label.underline === true ? 2 : 0
    );
    const cacheMode = numberOr(label.cacheMode, 0);
    const styleFlags =
        (label.bold ? 1 : 0) |
        (label.italic === true ? 2 : 0) |
        (label.underline === true ? 4 : 0);
    const comp = {
        __type__: "cc.Label",
        _name: "",
        _objFlags: 0,
        node: b.ref(nodeId),
        _enabled: true,
        _materials: [b.uuidRef(DEFAULT_UI_MATERIAL_2X)],
        _srcBlendFactor: 770,
        _dstBlendFactor: 771,
        _useOriginalSize: false,
        _string: text,
        _N$string: text,
        _horizontalAlign: horizontalAlign,
        _verticalAlign: verticalAlign,
        _actualFontSize: actualFontSize,
        _fontSize: fontSize,
        _fontFamily: fontFamily,
        _lineHeight: lineHeight,
        _overflow: overflow,
        _enableWrapText: wrap,
        _font: fontUuid ? b.uuidRef(fontUuid) : null,
        _N$file: fontUuid ? b.uuidRef(fontUuid) : null,
        _isSystemFontUsed: !fontUuid,
        _spacingX: spacingX,
        _batchAsBitmap: false,
        _styleFlags: styleFlags,
        _isBold: !!label.bold,
        _isItalic: label.italic === true,
        _isUnderline: label.underline === true,
        _underlineHeight: underlineHeight,
        _cacheMode: cacheMode,
        _N$horizontalAlign: horizontalAlign,
        _N$verticalAlign: verticalAlign,
        _N$fontFamily: fontFamily,
        _N$overflow: overflow,
        _N$cacheMode: cacheMode,
        _id: ""
    };
    const compId = b.add(comp);
    b.arr[nodeId]._color = b.color(rgba.r, rgba.g, rgba.b, rgba.a);
    const extra = [compId];
    if (label.outline) extra.push(emitLabelOutline2x(b, nodeId, label.outline));
    if (label.shadow) extra.push(emitLabelShadow2x(b, nodeId, label.shadow));
    return extra;
}

function emitNode2x(b, ir, parentId, meta, prefabId, pathKey) {
    const nodeId = b.add({
        __type__: "cc.Node",
        _name: ir.name,
        _objFlags: 0,
        _parent: parentId != null ? b.ref(parentId) : null,
        _children: [],
        _active: ir.active,
        _components: [],
        _prefab: null,
        _opacity: Math.round(Math.max(0, Math.min(1, ir.opacity)) * 255),
        _color: b.color(255, 255, 255, 255),
        _contentSize: b.size(ir.width, ir.height),
        _anchorPoint: b.vec2(0.5, 0.5),
        _trs: b.trs(ir.x, ir.y),
        _eulerAngles: b.vec3(0, 0, 0),
        _skewX: 0,
        _skewY: 0,
        _is3DNode: false,
        _groupIndex: 0,
        groupIndex: 0,
        _id: ""
    });

    const prefabInfoId = b.add({
        __type__: "cc.PrefabInfo",
        root: b.ref(nodeId),
        asset: b.ref(prefabId),
        fileId: b.fileId(pathKey),
        sync: false
    });
    b.arr[nodeId]._prefab = b.ref(prefabInfoId);

    const compIds = [];
    if (ir.kind === "sprite") {
        compIds.push(emitSprite2x(b, nodeId, ir, meta));
    } else if (ir.kind === "label") {
        compIds.push(...emitLabel2x(b, nodeId, ir, meta, pathKey));
    }
    b.arr[nodeId]._components = compIds.map((id) => b.ref(id));

    const childIds = [];
    for (const child of ir.children || []) {
        const childPath = `${pathKey}/${child.name}`;
        childIds.push(emitNode2x(b, child, nodeId, meta, prefabId, childPath));
    }
    b.arr[nodeId]._children = childIds.map((id) => b.ref(id));
    return nodeId;
}

function emitPrefab2x(ir, meta, options) {
    const b = new PrefabBuilder(options && options.fileIdMap);
    const prefabId = b.add({
        __type__: "cc.Prefab",
        _name: "",
        _objFlags: 0,
        _native: "",
        data: null,
        optimizationPolicy: 0,
        asyncLoadAssets: false,
        readonly: false
    });

    const rootId = emitNode2x(b, ir, null, meta, prefabId, ir.name);
    b.arr[prefabId].data = b.ref(rootId);
    b.arr[prefabId]._name = ir.name;
    return b.arr;
}

module.exports = { emitPrefab2x };
