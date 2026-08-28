"use strict";

const { PrefabBuilder } = require("./prefab-builder");

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

function emitLabelOutline3x(b, nodeId, outline, pathKey) {
    const color = colorOr(outline.color, { r: 0, g: 0, b: 0, a: 255 });
    return b.add({
        __type__: "cc.LabelOutline",
        _name: "",
        _objFlags: 0,
        node: b.ref(nodeId),
        _enabled: true,
        __prefab: b.compPrefabInfo(`${pathKey}#outline`),
        _color: b.color(color.r, color.g, color.b, color.a),
        _width: numberOr(outline.width, 0),
        _id: ""
    });
}

function emitLabelShadow3x(b, nodeId, shadow, pathKey) {
    const color = colorOr(shadow.color, { r: 0, g: 0, b: 0, a: 255 });
    return b.add({
        __type__: "cc.LabelShadow",
        _name: "",
        _objFlags: 0,
        node: b.ref(nodeId),
        _enabled: true,
        __prefab: b.compPrefabInfo(`${pathKey}#shadow`),
        _color: b.color(color.r, color.g, color.b, color.a),
        _offset: b.vec2(numberOr(shadow.offsetX, 0), numberOr(shadow.offsetY, 0)),
        _blur: numberOr(shadow.blur, 0),
        _id: ""
    });
}

function emitUiTransform3x(b, nodeId, ir, pathKey) {
    return b.add({
        __type__: "cc.UITransform",
        _name: "",
        _objFlags: 0,
        node: b.ref(nodeId),
        _enabled: true,
        __prefab: b.compPrefabInfo(`${pathKey}#transform`),
        _contentSize: b.size(ir.width, ir.height),
        _anchorPoint: b.vec2(0.5, 0.5),
        _id: ""
    });
}

function emitUiOpacity3x(b, nodeId, ir, pathKey) {
    return b.add({
        __type__: "cc.UIOpacity",
        _name: "",
        _objFlags: 0,
        node: b.ref(nodeId),
        _enabled: true,
        __prefab: b.compPrefabInfo(`${pathKey}#opacity`),
        _opacity: Math.round(Math.max(0, Math.min(1, ir.opacity)) * 255),
        _id: ""
    });
}

function emitSprite3x(b, nodeId, ir, meta, pathKey) {
    const uuid = meta.spriteFrameUuid(ir.spriteFramePath);
    return b.add({
        __type__: "cc.Sprite",
        _name: "",
        _objFlags: 0,
        node: b.ref(nodeId),
        _enabled: true,
        __prefab: b.compPrefabInfo(`${pathKey}#sprite`),
        _customMaterial: null,
        _srcBlendFactor: 2,
        _dstBlendFactor: 4,
        _color: b.color(255, 255, 255, 255),
        _spriteFrame: uuid ? b.uuidRef(uuid) : null,
        _type: 0,
        _fillType: 0,
        _sizeMode: 1,
        _fillCenter: b.vec2(0, 0),
        _fillStart: 0,
        _fillRange: 0,
        _isTrimmedMode: true,
        _useGrayscale: false,
        _atlas: null,
        _id: ""
    });
}

function emitLabel3x(b, nodeId, ir, meta, pathKey) {
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
    const compId = b.add({
        __type__: "cc.Label",
        _name: "",
        _objFlags: 0,
        node: b.ref(nodeId),
        _enabled: true,
        __prefab: b.compPrefabInfo(`${pathKey}#label`),
        _customMaterial: null,
        _srcBlendFactor: 2,
        _dstBlendFactor: 4,
        _color: b.color(rgba.r, rgba.g, rgba.b, rgba.a),
        _string: text,
        _horizontalAlign: horizontalAlign,
        _verticalAlign: verticalAlign,
        _actualFontSize: actualFontSize,
        _fontSize: fontSize,
        _fontFamily: fontFamily,
        _lineHeight: lineHeight,
        _overflow: overflow,
        _enableWrapText: wrap,
        _font: fontUuid ? b.uuidRef(fontUuid) : null,
        _isSystemFontUsed: !fontUuid,
        _isItalic: label.italic === true,
        _isBold: !!label.bold,
        _isUnderline: label.underline === true,
        _underlineHeight: numberOr(label.underlineHeight, 0),
        _cacheMode: numberOr(label.cacheMode, 0),
        _spacingX: spacingX,
        _id: ""
    });

    const extra = [compId];
    if (label.outline) extra.push(emitLabelOutline3x(b, nodeId, label.outline, pathKey));
    if (label.shadow) extra.push(emitLabelShadow3x(b, nodeId, label.shadow, pathKey));
    return extra;
}

function emitNode3x(b, ir, parentId, meta, prefabId, pathKey) {
    const nodeId = b.add({
        __type__: "cc.Node",
        _name: ir.name,
        _objFlags: 0,
        _parent: parentId != null ? b.ref(parentId) : null,
        _children: [],
        _active: ir.active,
        _components: [],
        _prefab: null,
        _lpos: b.vec3(ir.x, ir.y, 0),
        _lrot: b.quat(0, 0, 0, 1),
        _lscale: b.vec3(1, 1, 1),
        _mobility: 0,
        _layer: 33554432,
        _euler: b.vec3(0, 0, 0),
        _id: ""
    });

    const prefabInfoId = b.add({
        __type__: "cc.PrefabInfo",
        root: b.ref(nodeId),
        asset: b.ref(prefabId),
        fileId: b.fileId(pathKey),
        instance: null,
        targetOverrides: null,
        nestedPrefabInstanceRoots: null
    });
    b.arr[nodeId]._prefab = b.ref(prefabInfoId);

    const compIds = [
        emitUiTransform3x(b, nodeId, ir, pathKey),
        emitUiOpacity3x(b, nodeId, ir, pathKey)
    ];
    if (ir.kind === "sprite") {
        compIds.push(emitSprite3x(b, nodeId, ir, meta, pathKey));
    } else if (ir.kind === "label") {
        compIds.push(...emitLabel3x(b, nodeId, ir, meta, pathKey));
    }
    b.arr[nodeId]._components = compIds.map((id) => b.ref(id));

    const childIds = [];
    for (const child of ir.children || []) {
        const childPath = `${pathKey}/${child.name}`;
        childIds.push(emitNode3x(b, child, nodeId, meta, prefabId, childPath));
    }
    b.arr[nodeId]._children = childIds.map((id) => b.ref(id));
    return nodeId;
}

function emitPrefab3x(ir, meta, options) {
    const b = new PrefabBuilder(options && options.fileIdMap);
    const prefabId = b.add({
        __type__: "cc.Prefab",
        _name: "",
        _objFlags: 0,
        _native: "",
        data: null,
        optimizationPolicy: 0,
        persistent: false
    });

    const rootId = emitNode3x(b, ir, null, meta, prefabId, ir.name);
    b.arr[prefabId].data = b.ref(rootId);
    b.arr[prefabId]._name = ir.name;
    return b.arr;
}

module.exports = { emitPrefab3x };
