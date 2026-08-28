"use strict";

function centerOf(node) {
    return {
        x: (node.x || 0) + (node.width || 0) / 2,
        y: (node.y || 0) + (node.height || 0) / 2
    };
}

function absFrame(node) {
    return {
        x: node.x || 0,
        y: node.y || 0,
        width: node.width || 0,
        height: node.height || 0
    };
}

function relPos(node, parent) {
    if (!parent) return { x: 0, y: 0 };
    const nodeCenter = centerOf(node);
    const parentCenter = centerOf(parent);
    return {
        x: nodeCenter.x - parentCenter.x,
        y: nodeCenter.y - parentCenter.y
    };
}

function orderedChildren(node) {
    return (node.children || []).slice().reverse();
}

function toRgba(color) {
    const c = color || [255, 255, 255, 255];
    return {
        r: c[0] | 0,
        g: c[1] | 0,
        b: c[2] | 0,
        a: c[3] != null ? c[3] | 0 : 255
    };
}

function toKind(type) {
    if (type === "sprite") return "sprite";
    if (type === "label") return "label";
    return "group";
}

function strokeColor(stroke) {
    const stops = stroke.gradient && Array.isArray(stroke.gradient.stops)
        ? stroke.gradient.stops.slice().sort((a, b) => a.location - b.location)
        : [];
    if (stroke.fillType === "gradient" && stops.length) {
        const pick = stroke.reverse ? stops[0] : stops[stops.length - 1];
        return toRgba(pick.color || [0, 0, 0, 255]);
    }
    return toRgba(stroke.color || [0, 0, 0, 255]);
}

function buildOutline(effects) {
    const stroke = effects && effects.stroke;
    if (!stroke || !stroke.enabled || !(stroke.size > 0)) return null;
    return {
        width: stroke.size,
        color: strokeColor(stroke),
        approximated: stroke.fillType === "gradient"
    };
}

function buildShadow(effects) {
    const drop = effects && effects.dropShadow;
    if (!drop || !drop.enabled) return null;
    const distance = Number(drop.distance) || 0;
    const blur = Math.max(0, Number(drop.blur) || 0);
    if (distance <= 0 && blur <= 0) return null;
    const angle = ((drop.angle != null ? drop.angle : 90) * Math.PI) / 180;
    const offsetX = Number((-Math.cos(angle) * distance).toFixed(2)) || 0;
    const offsetY = Number((-Math.sin(angle) * distance).toFixed(2)) || 0;
    return {
        color: toRgba(drop.color || [0, 0, 0, 255]),
        offsetX,
        offsetY,
        blur
    };
}

function buildLabelIr(node) {
    const effects = node.effects || null;
    return {
        text: node.text || "",
        fontSize: node.fontSize || 24,
        lineHeight: node.lineHeight || node.fontSize || 24,
        color: toRgba(node.color),
        letterSpacing: node.letterSpacing || 0,
        bold: !!node.bold,
        fontFamily: node.fontFamily || "",
        paragraph: !!node.paragraph,
        outline: buildOutline(effects),
        shadow: buildShadow(effects),
        effects
    };
}

function hasGradientOverlay(node) {
    const gradient = node.effects && node.effects.gradientOverlay;
    return !!(gradient && gradient.enabled);
}

function walkDescNode(node, parentAbs, warnings) {
    const pos = relPos(node, parentAbs);
    const kind = toKind(node.type);
    const ir = {
        name: node.name || "node",
        active: node.visible !== false,
        opacity: Number.isFinite(node.opacity) ? node.opacity : 1,
        x: pos.x,
        y: pos.y,
        width: node.width || 0,
        height: node.height || 0,
        kind,
        children: []
    };

    if (kind === "sprite") {
        ir.spriteFramePath = node.spriteFramePath || "";
    } else if (kind === "label") {
        ir.label = buildLabelIr(node);
        if (ir.label.outline && ir.label.outline.approximated) {
            warnings.push(`渐变描边已转为纯色 LabelOutline: ${ir.name}`);
        }
        if (hasGradientOverlay(node)) {
            warnings.push(`跳过渐变文字填充: ${ir.name}`);
        }
    }

    const abs = absFrame(node);
    for (const child of orderedChildren(node)) {
        ir.children.push(walkDescNode(child, abs, warnings));
    }
    return ir;
}

function buildIr(rootDesc) {
    const warnings = [];
    const root = {
        name: rootDesc.name || "root",
        active: rootDesc.visible !== false,
        opacity: Number.isFinite(rootDesc.opacity) ? rootDesc.opacity : 1,
        x: 0,
        y: 0,
        width: rootDesc.width || 0,
        height: rootDesc.height || 0,
        kind: "group",
        children: []
    };

    const parentAbs = absFrame(rootDesc);
    for (const child of orderedChildren(rootDesc)) {
        root.children.push(walkDescNode(child, parentAbs, warnings));
    }
    return { root, warnings };
}

module.exports = {
    relPos,
    orderedChildren,
    buildIr,
    toRgba,
    buildOutline,
    buildShadow,
    hasGradientOverlay
};
