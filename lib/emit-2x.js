"use strict";

const { PrefabBuilder } = require("./prefab-builder");

const DEFAULT_UI_MATERIAL_2X = "eca5d2f2-8ef6-41c2-bbe6-a9ac17cabc6b";

function shouldAddOutline(label) {
    const stroke = label && label.effects && label.effects.stroke;
    if (!stroke || !stroke.enabled || !(stroke.size > 0)) return null;
    if (stroke.fillType === "gradient") return null;
    const c = stroke.color || [0, 0, 0, 255];
    return {
        width: stroke.size,
        color: { r: c[0] | 0, g: c[1] | 0, b: c[2] | 0, a: c[3] != null ? c[3] | 0 : 255 }
    };
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

function emitLabel2x(b, nodeId, ir, meta) {
    const label = ir.label;
    const fontUuid = meta.fontUuid(label.fontFamily);
    const rgba = label.color;
    const overflow = label.paragraph ? 3 : 0;
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
        _string: label.text,
        _N$string: label.text,
        _fontSize: label.fontSize,
        _lineHeight: label.lineHeight,
        _enableWrapText: label.paragraph,
        _N$file: fontUuid ? b.uuidRef(fontUuid) : null,
        _isSystemFontUsed: !fontUuid,
        _spacingX: label.letterSpacing || 0,
        _batchAsBitmap: false,
        _styleFlags: label.bold ? 1 : 0,
        _underlineHeight: 0,
        _N$horizontalAlign: 0,
        _N$verticalAlign: 1,
        _N$fontFamily: label.fontFamily || "Arial",
        _N$overflow: overflow,
        _N$cacheMode: 0,
        _id: ""
    };
    const compId = b.add(comp);
    b.arr[nodeId]._color = b.color(rgba.r, rgba.g, rgba.b, rgba.a);
    const outline = shouldAddOutline(label);
    if (!outline) return [compId];

    const outlineId = b.add({
        __type__: "cc.LabelOutline",
        _name: "",
        _objFlags: 0,
        node: b.ref(nodeId),
        _enabled: true,
        _color: b.color(outline.color.r, outline.color.g, outline.color.b, outline.color.a),
        _width: outline.width,
        _id: ""
    });
    return [compId, outlineId];
}

function emitNode2x(b, ir, parentId, meta, prefabId) {
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
        _anchorPoint: b.vec2(0, 0),
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
        fileId: b.fileId(),
        sync: false
    });
    b.arr[nodeId]._prefab = b.ref(prefabInfoId);

    const compIds = [];
    if (ir.kind === "sprite") {
        compIds.push(emitSprite2x(b, nodeId, ir, meta));
    } else if (ir.kind === "label") {
        compIds.push(...emitLabel2x(b, nodeId, ir, meta));
    }
    b.arr[nodeId]._components = compIds.map((id) => b.ref(id));

    const childIds = [];
    for (const child of ir.children || []) {
        childIds.push(emitNode2x(b, child, nodeId, meta, prefabId));
    }
    b.arr[nodeId]._children = childIds.map((id) => b.ref(id));
    return nodeId;
}

function emitPrefab2x(ir, meta) {
    const b = new PrefabBuilder();
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

    const rootId = emitNode2x(b, ir, null, meta, prefabId);
    b.arr[prefabId].data = b.ref(rootId);
    b.arr[prefabId]._name = ir.name;
    return b.arr;
}

module.exports = { emitPrefab2x };
