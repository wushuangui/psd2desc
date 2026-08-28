"use strict";

const { PrefabBuilder } = require("./prefab-builder");

function emitLabelOutline3x(b, nodeId, outline) {
    return b.add({
        __type__: "cc.LabelOutline",
        _name: "",
        _objFlags: 0,
        node: b.ref(nodeId),
        _enabled: true,
        __prefab: b.compPrefabInfo(),
        _color: b.color(outline.color.r, outline.color.g, outline.color.b, outline.color.a),
        _width: outline.width,
        _id: ""
    });
}

function emitLabelShadow3x(b, nodeId, shadow) {
    return b.add({
        __type__: "cc.LabelShadow",
        _name: "",
        _objFlags: 0,
        node: b.ref(nodeId),
        _enabled: true,
        __prefab: b.compPrefabInfo(),
        _color: b.color(shadow.color.r, shadow.color.g, shadow.color.b, shadow.color.a),
        _offset: b.vec2(shadow.offsetX, shadow.offsetY),
        _blur: shadow.blur,
        _id: ""
    });
}

function emitUiTransform3x(b, nodeId, ir) {
    return b.add({
        __type__: "cc.UITransform",
        _name: "",
        _objFlags: 0,
        node: b.ref(nodeId),
        _enabled: true,
        __prefab: b.compPrefabInfo(),
        _contentSize: b.size(ir.width, ir.height),
        _anchorPoint: b.vec2(0.5, 0.5),
        _id: ""
    });
}

function emitUiOpacity3x(b, nodeId, ir) {
    return b.add({
        __type__: "cc.UIOpacity",
        _name: "",
        _objFlags: 0,
        node: b.ref(nodeId),
        _enabled: true,
        __prefab: b.compPrefabInfo(),
        _opacity: Math.round(Math.max(0, Math.min(1, ir.opacity)) * 255),
        _id: ""
    });
}

function emitSprite3x(b, nodeId, ir, meta) {
    const uuid = meta.spriteFrameUuid(ir.spriteFramePath);
    return b.add({
        __type__: "cc.Sprite",
        _name: "",
        _objFlags: 0,
        node: b.ref(nodeId),
        _enabled: true,
        __prefab: b.compPrefabInfo(),
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

function emitLabel3x(b, nodeId, ir, meta) {
    const label = ir.label;
    const fontUuid = meta.fontUuid(label.fontFamily);
    const rgba = label.color;
    const overflow = label.paragraph ? 3 : 0;
    const compId = b.add({
        __type__: "cc.Label",
        _name: "",
        _objFlags: 0,
        node: b.ref(nodeId),
        _enabled: true,
        __prefab: b.compPrefabInfo(),
        _customMaterial: null,
        _srcBlendFactor: 2,
        _dstBlendFactor: 4,
        _color: b.color(rgba.r, rgba.g, rgba.b, rgba.a),
        _string: label.text,
        _horizontalAlign: 0,
        _verticalAlign: 1,
        _actualFontSize: label.fontSize,
        _fontSize: label.fontSize,
        _fontFamily: label.fontFamily || "Arial",
        _lineHeight: label.lineHeight,
        _overflow: overflow,
        _enableWrapText: label.paragraph,
        _font: fontUuid ? b.uuidRef(fontUuid) : null,
        _isSystemFontUsed: !fontUuid,
        _isItalic: false,
        _isBold: !!label.bold,
        _isUnderline: false,
        _underlineHeight: 0,
        _cacheMode: 0,
        _id: ""
    });

    const extra = [compId];
    if (label.outline) extra.push(emitLabelOutline3x(b, nodeId, label.outline));
    if (label.shadow) extra.push(emitLabelShadow3x(b, nodeId, label.shadow));
    return extra;
}

function emitNode3x(b, ir, parentId, meta, prefabId) {
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
        fileId: b.fileId(),
        instance: null,
        targetOverrides: null,
        nestedPrefabInstanceRoots: null
    });
    b.arr[nodeId]._prefab = b.ref(prefabInfoId);

    const compIds = [
        emitUiTransform3x(b, nodeId, ir),
        emitUiOpacity3x(b, nodeId, ir)
    ];
    if (ir.kind === "sprite") {
        compIds.push(emitSprite3x(b, nodeId, ir, meta));
    } else if (ir.kind === "label") {
        compIds.push(...emitLabel3x(b, nodeId, ir, meta));
    }
    b.arr[nodeId]._components = compIds.map((id) => b.ref(id));

    const childIds = [];
    for (const child of ir.children || []) {
        childIds.push(emitNode3x(b, child, nodeId, meta, prefabId));
    }
    b.arr[nodeId]._children = childIds.map((id) => b.ref(id));
    return nodeId;
}

function emitPrefab3x(ir, meta) {
    const b = new PrefabBuilder();
    const prefabId = b.add({
        __type__: "cc.Prefab",
        _name: "",
        _objFlags: 0,
        _native: "",
        data: null,
        optimizationPolicy: 0,
        persistent: false
    });

    const rootId = emitNode3x(b, ir, null, meta, prefabId);
    b.arr[prefabId].data = b.ref(rootId);
    b.arr[prefabId]._name = ir.name;
    return b.arr;
}

module.exports = { emitPrefab3x };
