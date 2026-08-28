const fs = require("fs-extra");
const path = require("path");

const LABEL_FONT_FALLBACK = `'Source Han Sans SC','Noto Sans CJK SC','Microsoft YaHei',sans-serif`;

function descriptorNumber(value, fallback = 0) {
    if (Number.isFinite(value)) return value;
    if (value && Number.isFinite(value.value)) return value.value;
    return fallback;
}

function escapeHtml(str) {
    return String(str == null ? "" : str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function cssRgba(color) {
    const c = color || [0, 0, 0, 255];
    const alpha = Math.max(0, Math.min(1, (c[3] == null ? 255 : c[3]) / 255));
    return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Number(alpha.toFixed(3))})`;
}

function cssGradient(effect) {
    const gradient = effect && effect.gradient;
    if (!gradient || !gradient.stops || !gradient.stops.length) return "";
    const source = gradient.stops.slice().sort((a, b) => a.location - b.location);
    let stops = [];
    for (let i = 0; i < source.length; i++) {
        const stop = source[i];
        stops.push({ location: stop.location, color: stop.color });
        const next = source[i + 1];
        if (next && stop.midpoint != null && Math.abs(stop.midpoint - 50) > 0.1) {
            const location = stop.location + (next.location - stop.location) * stop.midpoint / 100;
            const color = stop.color.map((value, channel) =>
                Math.round((value + next.color[channel]) / 2));
            stops.push({ location, color });
        }
    }
    if (effect.reverse) {
        stops = stops.map((stop) => ({ location: 1 - stop.location, color: stop.color }));
    }
    const scale = Math.max(1, descriptorNumber(effect.scale, 100)) / 100;
    stops = stops.map((stop) => ({
        location: 0.5 + (stop.location - 0.5) * scale,
        color: stop.color
    })).sort((a, b) => a.location - b.location);
    const stopCss = stops
        .map((stop) => `${cssRgba(stop.color)} ${Number((stop.location * 100).toFixed(2))}%`)
        .join(",");
    const type = String(effect.type || "Lnr").trim();
    if (type === "Rdl" || type === "radial") return `radial-gradient(circle,${stopCss})`;
    const cssAngle = Number((90 - (effect.angle || 0)).toFixed(2));
    return `linear-gradient(${cssAngle}deg,${stopCss})`;
}

function isTightSingleLineLabel(node) {
    const text = String(node.text || "");
    if (text.indexOf("\n") >= 0) return false;
    const boxH = node.height || 0;
    const fontSize = node.fontSize || 24;
    const lineH = node.lineHeight || fontSize * 1.2;
    return boxH > 0 && lineH > boxH * 1.1;
}

function isWrappingParagraph(node) {
    if (!node || !node.paragraph) return false;
    const text = String(node.text || "");
    if (text.indexOf("\n") >= 0) return true;
    if (isTightSingleLineLabel(node)) return false;
    const fontSize = node.fontSize || 24;
    const visual = text.replace(/[\u200b\uFEFF]/g, "");
    const n = [...visual].length;
    const est = n * fontSize + Math.max(0, n - 1) * (node.letterSpacing || 0);
    return est > (node.width || 0) * 1.15;
}

function applyTextEffects(style, node) {
    const effects = node.effects;
    if (!effects) return { hasGradientStroke: false, hasGradientFill: false };
    let hasGradientStroke = false;
    const stroke = effects.stroke;
    const strokeSize = (stroke && stroke.enabled && stroke.size > 0) ? stroke.size : 0;
    const cssStrokeSize = stroke && stroke.position === "outside" ? strokeSize * 2 : strokeSize;
    const gradientHeight = Math.max(1, Math.round((node.fontSize || 24) + cssStrokeSize));

    const overlay = effects.colorOverlay;
    if (overlay && overlay.enabled && overlay.color) {
        style.push(`color:${cssRgba(overlay.color)}`);
    }

    const gradient = effects.gradientOverlay;
    const gradientCss = gradient && gradient.enabled ? cssGradient(gradient) : "";
    if (gradientCss) {
        style.push(`--psd-gradient-height:${gradientHeight}px`);
        style.push(`background-image:${gradientCss}`);
        style.push("background-size:100% var(--psd-gradient-height)");
        style.push("background-repeat:no-repeat");
        style.push("background-clip:text");
        style.push("-webkit-background-clip:text");
        style.push("color:transparent");
        style.push("-webkit-text-fill-color:transparent");
    }

    if (stroke && stroke.enabled && stroke.size > 0) {
        const strokeGradient = stroke.gradient && stroke.fillType !== "color"
            ? cssGradient(stroke)
            : "";
        if (strokeGradient) {
            style.push(`--psd-gradient-height:${gradientHeight}px`);
            style.push(`--psd-stroke-width:${Number(cssStrokeSize.toFixed(2))}px`);
            style.push(`--psd-stroke-gradient:${strokeGradient}`);
            hasGradientStroke = true;
        } else if (stroke.color) {
            style.push(`-webkit-text-stroke:${Number(cssStrokeSize.toFixed(2))}px ${cssRgba(stroke.color)}`);
            if (gradientCss) style.push(`-webkit-text-stroke-color:${cssRgba(stroke.color)}`);
        }
    }

    const shadows = [];
    const drop = effects.dropShadow;
    if (drop && drop.enabled && drop.color) {
        const angle = drop.angle * Math.PI / 180;
        const x = Number((-Math.cos(angle) * drop.distance).toFixed(2));
        const y = Number((Math.sin(angle) * drop.distance).toFixed(2));
        shadows.push(`${x}px ${y}px ${Number(drop.blur.toFixed(2))}px ${cssRgba(drop.color)}`);
    }
    const glow = effects.outerGlow;
    if (glow && glow.enabled) {
        const glowColor = glow.color || (glow.gradient && glow.gradient.stops &&
            glow.gradient.stops.length ? glow.gradient.stops[0].color : null);
        if (glowColor) {
            const blur = Number(Math.max(0, glow.blur).toFixed(2));
            shadows.push(`0 0 ${blur}px ${cssRgba(glowColor)}`);
            if (glow.spread > 0) {
                shadows.push(`0 0 ${Number((blur * 0.5).toFixed(2))}px ${cssRgba(glowColor)}`);
            }
        }
    }
    if (shadows.length) {
        if (hasGradientStroke) {
            style.push(`--psd-text-shadow:${shadows.join(",")}`);
        } else {
            style.push(`text-shadow:${shadows.join(",")}`);
        }
    }
    if (hasGradientStroke) {
        const fillColor = overlay && overlay.enabled && overlay.color
            ? overlay.color
            : (node.color || [255, 255, 255, 255]);
        style.push(`--psd-fill-color:${cssRgba(fillColor)}`);
        if (gradientCss) style.push(`--psd-fill-gradient:${gradientCss}`);
        style.push("color:transparent");
        style.push("-webkit-text-fill-color:transparent");
    }
    return { hasGradientStroke, hasGradientFill: !!gradientCss };
}

function applySpriteEffects(style, node) {
    const effects = node.effects;
    if (!effects) return;
    const filters = [];

    const drop = effects.dropShadow;
    if (drop && drop.enabled && drop.color) {
        const angle = drop.angle * Math.PI / 180;
        const x = Number((-Math.cos(angle) * drop.distance).toFixed(2));
        const y = Number((Math.sin(angle) * drop.distance).toFixed(2));
        const blur = Number((Math.max(0, drop.blur) * 0.5).toFixed(2));
        filters.push(`drop-shadow(${x}px ${y}px ${blur}px ${cssRgba(drop.color)})`);
    }

    const glow = effects.outerGlow;
    if (glow && glow.enabled) {
        const color = glow.color || (glow.gradient && glow.gradient.stops.length
            ? glow.gradient.stops[0].color
            : null);
        if (color) {
            const blur = Number((Math.max(0, glow.blur) * 0.5).toFixed(2));
            filters.push(`drop-shadow(0 0 ${blur}px ${cssRgba(color)})`);
        }
    }

    if (filters.length) style.push(`filter:${filters.join(" ")}`);
}

function spriteNodeKey(node) {
    return node.spriteFramePath || node.name || "";
}

function isManualLayoutText(text) {
    return / {4,}/.test(String(text || ""));
}

function boxesOverlap(a, b) {
    const aLeft = a.x || 0;
    const aBottom = a.y || 0;
    const aTop = aBottom + (a.height || 0);
    const aRight = aLeft + (a.width || 0);
    const bLeft = b.x || 0;
    const bBottom = b.y || 0;
    const bTop = bBottom + (b.height || 0);
    const bRight = bLeft + (b.width || 0);
    return aLeft < bRight && aRight > bLeft && aBottom < bTop && aTop > bBottom;
}

function isInlineMixSprite(label, sprite) {
    if (sprite.type !== "sprite") return false;
    if (!boxesOverlap(label, sprite)) return false;
    const fontSize = label.fontSize || 24;
    const maxHeight = Math.max(120, fontSize * 5);
    const maxWidth = Math.max(240, fontSize * 12);
    const w = sprite.width || 0;
    const h = sprite.height || 0;
    return w > 0 && h > 0 && h <= maxHeight && w <= maxWidth;
}

function lineVisualHeight(label) {
    // 行高只跟 PSD Leading 走。重叠的 sprite 是独立图层，不能把文字行撑高，
    // 否则编号层（无图）和正文层（有图）行距会错开，出现「3.」后面空一大截。
    return label.lineHeight || (label.fontSize || 24) * 1.2;
}

function manualLineBandYAt(label, lineIndex, lines, spriteHeights) {
    const labelTop = (label.y || 0) + (label.height || 0);
    let cursor = labelTop;
    for (let i = 0; i < lineIndex; i++) {
        cursor -= lineVisualHeight(label);
    }
    const h = lineVisualHeight(label);
    return { center: cursor - h / 2, half: h / 2 };
}

function getManualLayoutLines(text) {
    return String(text || "").split("\n")
        .map((line, index) => ({ line, index, spaceRuns: (line.match(/ {4,}/g) || []).length }))
        .filter((entry) => entry.spaceRuns > 0);
}

function manualLineBandY(label, lineIndex, lines, spriteHeights) {
    if (lines) return manualLineBandYAt(label, lineIndex, lines, spriteHeights);
    const lineHeight = label.lineHeight || (label.fontSize || 24) * 1.2;
    const labelTop = (label.y || 0) + (label.height || 0);
    const center = labelTop - lineIndex * lineHeight - lineHeight / 2;
    return { center, half: lineHeight / 2 };
}

function spriteCenterY(sprite) {
    return (sprite.y || 0) + (sprite.height || 0) / 2;
}

function getInlineSpritesForLabel(label, siblings) {
    if (!isManualLayoutText(label.text)) return [];
    const manualLines = getManualLayoutLines(label.text);
    if (!manualLines.length) return [];
    const candidates = siblings.filter((s) => isInlineMixSprite(label, s));
    const matched = [];
    const used = new Set();
    for (const { index, spaceRuns } of manualLines) {
        const band = manualLineBandY(label, index);
        const lineSprites = candidates
            .filter((s) => {
                const key = spriteNodeKey(s);
                if (used.has(key)) return false;
                const cy = spriteCenterY(s);
                const tolerance = band.half + (s.height || 0) / 2;
                return Math.abs(cy - band.center) <= tolerance;
            })
            .sort((a, b) => (a.x || 0) - (b.x || 0))
            .slice(0, spaceRuns);
        for (const sprite of lineSprites) {
            used.add(spriteNodeKey(sprite));
            matched.push(sprite);
        }
    }
    return matched.sort((a, b) => (a.x || 0) - (b.x || 0));
}

function spriteHeightsForLabel(label, siblings) {
    const heights = {};
    if (!isManualLayoutText(label.text)) return heights;
    const sprites = getInlineSpritesForLabel(label, siblings || []);
    const manualLines = getManualLayoutLines(label.text);
    let spriteIdx = 0;
    for (const { index, spaceRuns } of manualLines) {
        let maxH = 0;
        for (let n = 0; n < spaceRuns && spriteIdx < sprites.length; n++) {
            maxH = Math.max(maxH, sprites[spriteIdx].height || label.fontSize || 24);
            spriteIdx++;
        }
        if (maxH > 0) heights[index] = maxH;
    }
    return heights;
}

function lineBandOverlapsLabel(band, other) {
    if (!other || other.type !== "label") return false;
    const otherBottom = other.y || 0;
    const otherTop = otherBottom + (other.height || 0);
    const lineBottom = band.center - band.half;
    const lineTop = band.center + band.half;
    return lineBottom < otherTop && lineTop > otherBottom;
}

function lineBandsOverlap(a, b, gap = 1) {
    const aBottom = a.center - a.half;
    const aTop = a.center + a.half;
    const bBottom = b.center - b.half;
    const bTop = b.center + b.half;
    return aBottom < bTop - gap && aTop > bBottom + gap;
}

function hasOverlappingParagraphLabels(siblings) {
    const paragraphs = (siblings || []).filter((c) =>
        c.type === "label" && (c.paragraph || String(c.text || "").indexOf("\n") >= 0));
    for (let i = 0; i < paragraphs.length; i++) {
        for (let j = i + 1; j < paragraphs.length; j++) {
            if (boxesOverlap(paragraphs[i], paragraphs[j])) return true;
        }
    }
    return false;
}

function lineBottomInLabel(label, lineIndex, lines, spriteHeights) {
    const band = manualLineBandYAt(label, lineIndex, lines, spriteHeights);
    return { bottom: (band.center - band.half) - (label.y || 0), height: band.half * 2, band };
}

function trimmedLineText(line) {
    return String(line || "").replace(/[ \t\u200b\uFEFF]+/g, "").trim();
}

function isFillInOverlayLabel(label) {
    if (!label || label.type !== "label") return false;
    const listLines = String(label.text || "").split("\n")
        .filter((line) => /^[a-zA-Z]\.\s/.test(line.trim()));
    return listLines.length >= 2;
}

function isPlaceholderGapLine(lines, index) {
    if (trimmedLineText(lines[index])) return false;
    let blanksBefore = 0;
    for (let i = index - 1; i >= 0 && !trimmedLineText(lines[i]); i--) blanksBefore++;
    let blanksAfter = 0;
    for (let i = index + 1; i < lines.length && !trimmedLineText(lines[i]); i++) blanksAfter++;
    return blanksBefore >= 2 && blanksAfter >= 2;
}

function isDuplicatePhantomLine(allLines, lineIndex) {
    const text = trimmedLineText(allLines[lineIndex]);
    if (!text) return false;
    for (let i = 0; i < lineIndex; i++) {
        if (trimmedLineText(allLines[i]) === text) return true;
    }
    return false;
}

function getBodyLabelForOverlay(overlay, siblings) {
    const candidates = (siblings || []).filter((s) =>
        s !== overlay && s.type === "label" && s.paragraph &&
        !isFillInOverlayLabel(s) && boxesOverlap(overlay, s));
    if (!candidates.length) return null;
    return candidates.sort((a, b) => String(b.text || "").length - String(a.text || "").length)[0];
}

function subListBlankSlots(bodyLabel) {
    const bodyLines = String(bodyLabel.text || "").split("\n");
    const slots = [];
    let capture = false;
    for (let i = 0; i < bodyLines.length; i++) {
        const t = trimmedLineText(bodyLines[i]);
        if (t && /而变化[：:]$/.test(t)) {
            capture = true;
            continue;
        }
        if (!capture) continue;
        if (t && /每颗/.test(t)) break;
        if (!t && !/ {4,}/.test(bodyLines[i])) slots.push(i);
    }
    return { bodyLabel, bodyLines, slots };
}

function overlayLineRemap(label, siblings) {
    if (!isFillInOverlayLabel(label)) return null;
    const body = getBodyLabelForOverlay(label, siblings);
    if (!body) return null;
    const { bodyLines, slots } = subListBlankSlots(body);
    if (!slots.length) return null;
    return { body, bodyLines, slots };
}

function shouldSkipLineForSibling(label, lineIndex, line, siblings, allLines, useAbsoluteLines) {
    if (!trimmedLineText(line)) return false;
    if (isDuplicatePhantomLine(allLines, lineIndex)) return true;

    const spriteHeights = spriteHeightsForLabel(label, siblings);
    const band = manualLineBandY(label, lineIndex, allLines, spriteHeights);
    const overlay = (siblings || []).find((s) =>
        s !== label && s.type === "label" && isFillInOverlayLabel(s) &&
        boxesOverlap(label, s) && lineBandOverlapsLabel(band, s));
    if (!overlay) return false;

    if (isPlaceholderGapLine(allLines, lineIndex)) return true;

    if (!useAbsoluteLines && !isFillInOverlayLabel(label)) {
        const overlayLines = String(overlay.text || "").split("\n");
        const overlayHeights = spriteHeightsForLabel(overlay, siblings);
        for (let j = 0; j < overlayLines.length; j++) {
            if (!trimmedLineText(overlayLines[j])) continue;
            const ob = manualLineBandYAt(overlay, j, overlayLines, overlayHeights);
            if (lineBandsOverlap(band, ob, 3)) return true;
        }
    }

    let blanksBefore = 0;
    for (let i = lineIndex - 1; i >= 0 && !trimmedLineText(allLines[i]); i--) blanksBefore++;
    return !useAbsoluteLines && blanksBefore >= 2;
}

function cleanGroupLabelText(node) {
    if (!node.children || !node.children.length) return;
    for (const child of node.children) cleanGroupLabelText(child);
    const labels = node.children.filter((c) => c.type === "label");
    for (const label of labels) {
        const lines = String(label.text || "").split("\n");
        label.text = lines.map((line, i) =>
            shouldSkipLineForSibling(label, i, line, labels, lines, false) ? "" : line
        ).join("\n");
    }
}

function filterLabelLines(text, label, siblings, useAbsoluteLines) {
    const lines = String(text || "").split("\n");
    if (!label || !siblings || !siblings.length) return lines;
    return lines.map((line, i) =>
        shouldSkipLineForSibling(label, i, line, siblings, lines, useAbsoluteLines) ? "" : line);
}

function renderLabelTextContent(text, label, siblings, useAbsoluteLines) {
    const lines = filterLabelLines(text, label, siblings, useAbsoluteLines);
    const spriteHeights = label ? spriteHeightsForLabel(label, siblings || []) : {};
    const fontSize = (label && label.fontSize) || 24;
    const lineHeight = label
        ? Math.max(label.lineHeight || fontSize * 1.2, fontSize)
        : 24;
    const remap = useAbsoluteLines ? overlayLineRemap(label, siblings) : null;
    let subListIdx = 0;

    if (useAbsoluteLines && label) {
        const parts = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!trimmedLineText(line) && !/ {4,}/.test(line)) continue;
            let pos;
            if (remap && trimmedLineText(line)) {
                const slot = remap.slots[subListIdx];
                if (slot != null) {
                    const bodyHeights = spriteHeightsForLabel(remap.body, siblings);
                    const bodyPos = lineBottomInLabel(remap.body, slot, remap.bodyLines, bodyHeights);
                    pos = {
                        bottom: bodyPos.bottom + (remap.body.y || 0) - (label.y || 0),
                        height: bodyPos.height
                    };
                    subListIdx++;
                }
            }
            if (!pos) pos = lineBottomInLabel(label, i, lines, spriteHeights);
            const style = [
                `bottom:${Math.round(pos.bottom)}px`,
                `height:${Math.max(Math.round(pos.height), fontSize)}px`,
                `line-height:${Math.round(lineHeight)}px`
            ];
            const cls = / {4,}/.test(line) ? "abs-line manual-line" : "abs-line";
            parts.push(`<span class="${cls}" style="${style.join(";")}">${escapeHtml(line)}</span>`);
        }
        return parts.join("");
    }

    const src = lines.join("\n");
    if (!isManualLayoutText(src)) return escapeHtml(src);
    return lines.map((line) => {
        if (/ {4,}/.test(line)) {
            return `<span class="manual-line">${escapeHtml(line)}</span>`;
        }
        return escapeHtml(line);
    }).join("\n");
}

function buildLabelStyle(node, parent, useAbsoluteLines) {
    const left = (node.x || 0) - (parent ? parent.x || 0 : 0);
    const bottom = (node.y || 0) - (parent ? parent.y || 0 : 0);
    const opacity = Number.isFinite(node.opacity) ? node.opacity : 1;
    const style = [
        `left:${left}px`,
        `bottom:${bottom}px`,
        `width:${node.width || 0}px`,
        `height:${Math.max(node.height || 0, node.fontSize || 24)}px`,
        `opacity:${opacity}`
    ];
    if (node.visible === false) style.push("display:none");
    const c = node.color || [255, 255, 255, 255];
    const a = (c[3] != null ? c[3] : 255) / 255;
    const fontSize = node.fontSize || 24;
    style.push(`font-size:${fontSize}px`);
    style.push(`color:rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
    if (node.bold) style.push("font-weight:700");
    if (node.fontFamily) {
        style.push(`font-family:'${node.fontFamily.replace(/['\\]/g, "")}',${LABEL_FONT_FALLBACK}`);
    }
    if (node.letterSpacing) {
        style.push(`letter-spacing:${node.letterSpacing}px`);
    }
    const textEffects = applyTextEffects(style, node);
    if (textEffects.hasGradientStroke || textEffects.hasGradientFill) {
        style.push("line-height:1");
    } else if ((isWrappingParagraph(node) || String(node.text || "").indexOf("\n") >= 0) &&
        node.lineHeight && !useAbsoluteLines && !isTightSingleLineLabel(node)) {
        style.push(`line-height:${node.lineHeight}px`);
        const shift = (node.lineHeight - fontSize) / 2;
        if (shift > 0.5) style.push(`transform:translateY(${-Math.round(shift)}px)`);
    }
    return { style, textEffects, fontSize };
}

function renderLabelHtml(node, parent, siblings, useAbsoluteLines) {
    const name = escapeHtml(node.name || "");
    const cls = ["layer", "label"].join(" ");
    const { style: baseStyle, textEffects } = buildLabelStyle(node, parent, false);
    const absLines = useAbsoluteLines && isWrappingParagraph(node) && !textEffects.hasGradientStroke;
    const { style } = absLines ? buildLabelStyle(node, parent, true) : { style: baseStyle };
    const paragraphClass = isWrappingParagraph(node) ? " paragraph" : "";
    const absClass = absLines ? " absolute-lines" : "";
    const effectClass = textEffects.hasGradientStroke
        ? `${cls}${paragraphClass}${absClass} gradient-stroke${textEffects.hasGradientFill ? " gradient-fill" : ""}`
        : `${cls}${paragraphClass}${absClass}`;
    const dataText = textEffects.hasGradientStroke
        ? ` data-text="${escapeHtml(node.text || "")}"`
        : "";
    const inner = renderLabelTextContent(node.text, node, siblings, absLines);
    return `<div class="${effectClass}" data-name="${name}" title="${name}"${dataText} ` +
        `style="${style.join(";")}">${inner}</div>`;
}

function renderHtmlNode(node, parent, groupSiblings, useAbsoluteLines) {
    const left = (node.x || 0) - (parent ? parent.x || 0 : 0);
    const bottom = (node.y || 0) - (parent ? parent.y || 0 : 0);
    const opacity = Number.isFinite(node.opacity) ? node.opacity : 1;
    const name = escapeHtml(node.name || "");
    const cls = ["layer", node.type || "node"].join(" ");
    const style = [
        `left:${left}px`,
        `bottom:${bottom}px`,
        `width:${node.width || 0}px`,
        `height:${node.height || 0}px`,
        `opacity:${opacity}`
    ];
    if (node.visible === false) style.push("display:none");

    if (node.type === "sprite") {
        const file = path.basename(node.spriteFramePath || `${node.name}.png`);
        applySpriteEffects(style, node);
        return `<div class="${cls}" data-name="${name}" title="${name}" style="${style.join(";")}">` +
            `<img src="${escapeHtml(file)}" alt="${name}" draggable="false">` +
            `</div>`;
    }

    if (node.type === "label") {
        return renderLabelHtml(node, parent, groupSiblings, useAbsoluteLines);
    }

    const children = node.children || [];
    const absLines = useAbsoluteLines || hasOverlappingParagraphLabels(children);
    const kids = children
        .slice()
        .reverse()
        .map((child) => renderHtmlNode(child, node, children, absLines))
        .join("");
    return `<div class="${cls}" data-name="${name}" title="${name}" style="${style.join(";")}">${kids}</div>`;
}

function writePreviewHtml(rootDesc, exportDir) {
    fs.ensureDirSync(exportDir);
    const w = rootDesc.width || 1920;
    const h = rootDesc.height || 1080;
    const title = escapeHtml(rootDesc.name || "preview");
    const body = (rootDesc.children || [])
        .slice()
        .reverse()
        .map((c) => renderHtmlNode(c, { x: 0, y: 0 }))
        .join("\n");
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} preview</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: flex;
    flex-direction: column;
    background: #111;
    color: #ddd;
    font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 14px;
    background: #1c1c1c;
    border-bottom: 1px solid #333;
    font-size: 13px;
  }
  .toolbar .title { font-weight: 600; color: #fff; }
  .toolbar .meta { color: #888; }
  .toolbar button, .toolbar label {
    background: #2a2a2a;
    border: 1px solid #444;
    color: #ddd;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 12px;
  }
  .viewport {
    flex: 1;
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
      linear-gradient(45deg, #1a1a1a 25%, transparent 25%),
      linear-gradient(-45deg, #1a1a1a 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #1a1a1a 75%),
      linear-gradient(-45deg, transparent 75%, #1a1a1a 75%);
    background-size: 24px 24px;
    background-position: 0 0, 0 12px, 12px -12px, -12px 0;
    background-color: #151515;
  }
  .scaler { position: relative; }
  .stage {
    position: absolute;
    left: 0;
    top: 0;
    background: transparent;
    overflow: hidden;
    transform-origin: 0 0;
  }
  .layer { position: absolute; box-sizing: border-box; }
  .layer.sprite img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: fill;
    pointer-events: none;
  }
  .layer.label {
    white-space: pre;
    line-height: 1;
    overflow: visible;
    pointer-events: none;
  }
  .layer.label.paragraph {
    white-space: pre-wrap;
    overflow: visible;
    overflow-wrap: normal;
    word-break: normal;
  }
  .layer.label.paragraph .manual-line {
    white-space: pre;
    display: block;
    box-sizing: border-box;
  }
  .layer.label.paragraph.absolute-lines {
    white-space: normal;
    line-height: 1;
    overflow: visible;
  }
  .layer.label.paragraph.absolute-lines .abs-line {
    position: absolute;
    left: 0;
    right: 0;
    white-space: pre-wrap;
    overflow: visible;
    box-sizing: border-box;
  }
  .layer.label.paragraph.absolute-lines .abs-line.manual-line {
    white-space: pre;
  }
  .layer.label.gradient-stroke::before {
    content: attr(data-text);
    position: absolute;
    inset: 0;
    white-space: inherit;
    font: inherit;
    line-height: 1;
    letter-spacing: inherit;
    overflow: visible;
    color: transparent;
    -webkit-text-fill-color: transparent;
    -webkit-text-stroke: var(--psd-stroke-width) transparent;
    background-image: var(--psd-stroke-gradient);
    background-size: 100% var(--psd-gradient-height, 1em);
    background-repeat: no-repeat;
    background-clip: text;
    -webkit-background-clip: text;
    text-shadow: var(--psd-text-shadow, none);
    pointer-events: none;
  }
  .layer.label.gradient-stroke::after {
    content: attr(data-text);
    position: absolute;
    inset: 0;
    white-space: inherit;
    font: inherit;
    line-height: 1;
    letter-spacing: inherit;
    overflow: visible;
    color: var(--psd-fill-color);
    -webkit-text-fill-color: var(--psd-fill-color);
    -webkit-text-stroke: 0;
    text-shadow: none;
    pointer-events: none;
  }
  .layer.label.gradient-stroke.gradient-fill::after {
    color: transparent;
    -webkit-text-fill-color: transparent;
    background-image: var(--psd-fill-gradient);
    background-size: 100% var(--psd-gradient-height, 1em);
    background-repeat: no-repeat;
    background-clip: text;
    -webkit-background-clip: text;
  }
  body.show-outlines .layer { outline: 1px solid rgba(0, 220, 180, 0.45); }
  body.show-outlines .layer.label { outline-color: rgba(255, 196, 0, 0.7); }
  body.show-outlines .layer.sprite { outline-color: rgba(80, 160, 255, 0.55); }
</style>
</head>
<body>
  <div class="toolbar">
    <span class="title">${title}</span>
    <span class="meta">${w} × ${h}</span>
    <label><input type="checkbox" id="outlines"> 显示描边</label>
    <button type="button" id="fit">适应窗口</button>
    <button type="button" id="one">100%</button>
  </div>
  <div class="viewport" id="viewport">
    <div class="scaler" id="scaler">
      <div class="stage" id="stage" style="width:${w}px;height:${h}px">
${body}
      </div>
    </div>
  </div>
<script>
(function () {
  var W = ${w}, H = ${h}, mode = "fit";
  var stage = document.getElementById("stage");
  var scaler = document.getElementById("scaler");
  var viewport = document.getElementById("viewport");
  function apply(s) {
    scaler.style.width = (W * s) + "px";
    scaler.style.height = (H * s) + "px";
    stage.style.transform = "scale(" + s + ")";
  }
  function fit() {
    apply(Math.max(0.05, Math.min(viewport.clientWidth / W, viewport.clientHeight / H)));
  }
  function refresh() { mode === "fit" ? fit() : apply(1); }
  document.getElementById("outlines").addEventListener("change", function (e) {
    document.body.classList.toggle("show-outlines", e.target.checked);
  });
  document.getElementById("fit").addEventListener("click", function () { mode = "fit"; fit(); });
  document.getElementById("one").addEventListener("click", function () { mode = "one"; apply(1); });
  window.addEventListener("resize", refresh);
  fit();
})();
</script>
</body>
</html>
`;
    const outPath = path.join(exportDir, "index.html");
    fs.writeFileSync(outPath, html, "utf8");
    return outPath;
}

module.exports = {
    cleanGroupLabelText,
    writePreviewHtml
};

if (require.main === module) {
    const dirArg = process.argv[2];
    if (!dirArg) {
        console.error("用法: node desc2html.js <导出目录>");
        console.error("示例: node desc2html.js psd_export/bingoRule/2");
        process.exit(1);
    }
    const exportDir = path.resolve(dirArg);
    const jsonPath = path.join(exportDir, "ui_desc.json");
    if (!fs.existsSync(jsonPath)) {
        console.error(`找不到 ${jsonPath}`);
        process.exit(1);
    }
    const rootDesc = fs.readJsonSync(jsonPath);
    const htmlPath = writePreviewHtml(rootDesc, exportDir);
    console.log(`HTML: ${htmlPath}`);
}
