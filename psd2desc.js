const fs = require("fs-extra");
const path = require("path");
const { PNG } = require("pngjs");
const { cleanGroupLabelText, writePreviewHtml } = require("./desc2html");

// ========== 配置区 ==========
const PSD_DIR = "./psd";
const EXPORT_ROOT = "./psd_export";
const RESOURCES_SUB_PATH = "psd_out";
const EXPORT_PNG = true;
const EXPORT_HTML = true;
const TRIM_TRANSPARENT = true;
const TRIM_ALPHA_MIN = 1;
// ============================

let EXPORT_DIR = "";
const USED_PNG_NAMES = new Set();

const LONG_ALI_KEYS = new Set([
    "LMsk", "Lr16", "Lr32", "Layr", "Mt16", "Mt32", "Mtrn", "Alph",
    "FMsk", "lnk2", "lnk3", "lnkE", "FEid", "FXid", "PxSD", "cinf", "extn"
]);

class Reader {
    constructor(buf) {
        this.buf = buf;
        this.pos = 0;
    }

    get remaining() {
        return this.buf.length - this.pos;
    }

    u8() {
        return this.buf[this.pos++];
    }

    i8() {
        const v = this.buf.readInt8(this.pos);
        this.pos += 1;
        return v;
    }

    u16() {
        const v = this.buf.readUInt16BE(this.pos);
        this.pos += 2;
        return v;
    }

    i16() {
        const v = this.buf.readInt16BE(this.pos);
        this.pos += 2;
        return v;
    }

    u32() {
        const v = this.buf.readUInt32BE(this.pos);
        this.pos += 4;
        return v;
    }

    i32() {
        const v = this.buf.readInt32BE(this.pos);
        this.pos += 4;
        return v;
    }

    u64() {
        const v = this.buf.readBigUInt64BE(this.pos);
        this.pos += 8;
        return Number(v);
    }

    f64() {
        const v = this.buf.readDoubleBE(this.pos);
        this.pos += 8;
        return v;
    }

    f32() {
        const v = this.buf.readFloatBE(this.pos);
        this.pos += 4;
        return v;
    }

    str(n) {
        const s = this.buf.toString("latin1", this.pos, this.pos + n);
        this.pos += n;
        return s;
    }

    unicode(nChars) {
        const start = this.pos;
        this.pos += nChars * 2;
        const be = this.buf.subarray(start, this.pos);
        const le = Buffer.alloc(be.length);
        for (let i = 0; i < be.length; i += 2) {
            le[i] = be[i + 1];
            le[i + 1] = be[i];
        }
        return le.toString("utf16le").replace(/\0+$/g, "");
    }

    skip(n) {
        this.pos += n;
    }

    bytes(n) {
        const slice = this.buf.subarray(this.pos, this.pos + n);
        this.pos += n;
        return slice;
    }

    padTo(align, from) {
        const used = this.pos - from;
        const rem = used % align;
        if (rem) this.skip(align - rem);
    }
}

function psdYToCocosY(psdTop, layerH, docH) {
    return docH - psdTop - layerH;
}

function safeFileName(str) {
    return String(str || "unnamed").replace(/[\\\/:*?"<>|]/g, "_").trim() || "unnamed";
}

function parseCliArgs() {
    const args = process.argv.slice(2);
    const htmlOnly = args.includes("--html");
    const fileArg = args.find((a) => !a.startsWith("-"));
    return { htmlOnly, fileArg };
}

function resolvePsdFile(fileArg) {
    if (!fileArg) {
        throw new Error("请传入 PSD/PSB 文件，例如: node psd2desc.js bingoRule.psb");
    }
    if (fs.existsSync(fileArg)) return path.resolve(fileArg);
    const inPsdDir = path.join(PSD_DIR, fileArg);
    if (fs.existsSync(inPsdDir)) return path.resolve(inPsdDir);
    throw new Error(`找不到文件: ${fileArg}`);
}

function listExportIndexes(namedDir) {
    if (!fs.existsSync(namedDir)) return [];
    return fs.readdirSync(namedDir)
        .filter((name) => /^\d+$/.test(name) && fs.statSync(path.join(namedDir, name)).isDirectory())
        .map(Number)
        .sort((a, b) => a - b);
}

function nextExportDir(namedDir) {
    fs.ensureDirSync(namedDir);
    const indexes = listExportIndexes(namedDir);
    const next = indexes.length ? indexes[indexes.length - 1] + 1 : 0;
    const dir = path.join(namedDir, String(next));
    fs.ensureDirSync(dir);
    return dir;
}

function parsePsd(buf) {
    const r = new Reader(buf);
    const sig = r.str(4);
    if (sig !== "8BPS") throw new Error("不是有效的 PSD/PSB 文件");

    const version = r.u16();
    const isPsb = version === 2;
    r.skip(6);
    const channels = r.u16();
    const height = r.u32();
    const width = r.u32();
    const depth = r.u16();
    const colorMode = r.u16();

    const colorModeLen = r.u32();
    r.skip(colorModeLen);

    const resLen = r.u32();
    r.skip(resLen);

    const layerMaskLen = isPsb ? r.u64() : r.u32();
    const layerMaskEnd = r.pos + layerMaskLen;

    const layers = [];
    if (layerMaskLen > 0) {
        const layerInfoLen = isPsb ? r.u64() : r.u32();
        const layerInfoEnd = r.pos + layerInfoLen;

        if (layerInfoLen > 0) {
            let layerCount = r.i16();
            layerCount = Math.abs(layerCount);

            for (let i = 0; i < layerCount; i++) {
                layers.push(parseLayerRecord(r, isPsb));
            }

            for (const layer of layers) {
                layer.channelOffset = r.pos;
                layer.isPsb = isPsb;
                for (const ch of layer.channelInfo) {
                    r.skip(Math.max(0, ch.length));
                }
            }
        }

        r.pos = Math.max(r.pos, layerInfoEnd);
        if (r.pos < layerMaskEnd) {
            const globalMaskLen = r.u32();
            r.skip(globalMaskLen);
        }
        r.pos = layerMaskEnd;
    }

    return { version, isPsb, channels, width, height, depth, colorMode, layers };
}

function parseLayerRecord(r, isPsb) {
    let top = r.i32();
    let left = r.i32();
    let bottom = r.i32();
    let right = r.i32();
    const channelCount = r.u16();
    const channelInfo = [];
    for (let i = 0; i < channelCount; i++) {
        const id = r.i16();
        const length = isPsb ? r.u64() : r.u32();
        channelInfo.push({ id, length });
    }

    const blendSig = r.str(4);
    if (blendSig !== "8BIM") {
        throw new Error(`图层混合模式签名错误 @${r.pos - 4}: ${JSON.stringify(blendSig)}`);
    }
    const blendMode = r.str(4);
    const opacity = r.u8();
    r.u8(); // clipping
    const flags = r.u8();
    r.u8(); // filler
    const extraLen = r.u32();
    const extraEnd = r.pos + extraLen;

    const maskSize = r.u32();
    const mask = parseLayerMask(r, maskSize);

    const blendRangeLen = r.u32();
    r.skip(blendRangeLen);

    const nameStart = r.pos;
    const nameLen = r.u8();
    let name = r.str(nameLen);
    r.padTo(4, nameStart);

    let dividerType = 0;
    let text = null;
    let effects = null;
    while (r.pos + 12 <= extraEnd) {
        const sig = r.str(4);
        if (sig !== "8BIM" && sig !== "8B64") {
            r.pos -= 4;
            break;
        }
        const key = r.str(4);
        const dataLen = (isPsb && LONG_ALI_KEYS.has(key)) ? r.u64() : r.u32();
        if (dataLen < 0 || r.pos + dataLen > extraEnd) break;
        const data = r.bytes(dataLen);
        if (dataLen & 1 && r.pos < extraEnd) r.skip(1);

        if (key === "lsct" || key === "lsdk") {
            if (data.length >= 4) dividerType = data.readInt32BE(0);
        } else if (key === "luni") {
            try {
                const uni = new Reader(data);
                const count = uni.u32();
                const uniName = uni.unicode(count).replace(/\0+$/g, "");
                if (uniName) name = uniName;
            } catch (_) { /* ignore */ }
        } else if (key === "TySh") {
            text = parseTypeToolText(data);
        } else if (key === "lfx2" || key === "lmfx") {
            effects = parseObjectLayerEffects(data) || effects;
        }

        }

    r.pos = extraEnd;

    // 图层记录是渲染包围盒，TySh 才保存文字排版使用的真实原点和边界。
    // 统一采用 TySh，既修复 0×0 文本，也避免普通文字受效果外扩影响而偏移。
    if (text && text.layoutBounds) {
        let bounds = text.layoutBounds;
        const content = String(text.text || "");
        if (text.glyphBounds && content.indexOf("\n") < 0) {
            const frameW = bounds.right - bounds.left;
            const frameH = bounds.bottom - bounds.top;
            const glyphW = text.glyphBounds.right - text.glyphBounds.left;
            const glyphH = text.glyphBounds.bottom - text.glyphBounds.top;
            // 单行标题落在大段落文本框里时，图层特效渐变必须按字形范围映射。
            if (glyphW > 0 && glyphH > 0 && (glyphW < frameW * 0.85 || glyphH < frameH * 0.85)) {
                bounds = text.glyphBounds;
            }
        }
        left = bounds.left;
        top = bounds.top;
        right = bounds.right;
        bottom = bounds.bottom;
    }

    return {
        name,
        top,
        left,
        bottom,
        right,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
        opacity,
        hidden: !!(flags & 0x02),
        blendMode,
        dividerType,
        text,
        effects,
        mask,
        channelInfo
    };
}

function maskFromFields(top, left, bottom, right, defaultColor, flags) {
    return {
        top,
        left,
        bottom,
        right,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
        defaultColor,
        flags,
        relative: !!(flags & 0x01),
        disabled: !!(flags & 0x02),
        invert: !!(flags & 0x04)
    };
}

function parseLayerMask(r, maskSize) {
    if (maskSize <= 0) return null;
    const end = r.pos + maskSize;
    if (maskSize < 20) {
        r.pos = end;
        return null;
    }
    const mask = maskFromFields(r.i32(), r.i32(), r.i32(), r.i32(), r.u8(), r.u8());
    if (maskSize >= 36) {
        const realFlags = r.u8();
        const realDef = r.u8();
        const real = maskFromFields(r.i32(), r.i32(), r.i32(), r.i32(), realDef, realFlags);
        r.pos = end;
        if (!real.disabled && real.defaultColor === 0 && mask.defaultColor !== 0) return real;
        return mask;
    }
    r.pos = end;
    return mask;
}

function engineNumber(chunk, key) {
    const m = chunk.match(new RegExp("/" + key + "\\s+(-?[0-9.]+)"));
    return m ? Number(m[1]) : null;
}

function engineBool(chunk, key) {
    const m = chunk.match(new RegExp("/" + key + "\\s+(true|false)"));
    return m ? m[1] === "true" : null;
}

function engineColor(chunk) {
    const m = chunk.match(/\/FillColor\s*<<[\s\S]{0,80}?\/Values\s*\[([^\]]+)\]/);
    if (!m) return null;
    const nums = m[1].trim().split(/\s+/).map(Number).filter(Number.isFinite);
    const rgb = nums.length >= 4 ? nums.slice(1, 4) : nums.slice(0, 3);
    if (rgb.length < 3) return null;
    return [
        Math.round(Math.min(1, Math.max(0, rgb[0])) * 255),
        Math.round(Math.min(1, Math.max(0, rgb[1])) * 255),
        Math.round(Math.min(1, Math.max(0, rgb[2])) * 255),
        255
    ];
}

function engineFontNames(raw) {
    const start = raw.indexOf("/FontSet");
    if (start < 0) return [];
    const after = raw.indexOf("/SuperscriptSize", start);
    const section = raw.slice(start, after > start ? after : start + 20000);
    const names = [];
    const re = /\/Name\s*\(([\s\S]*?)\)/g;
    let m;
    while ((m = re.exec(section))) {
        const name = m[1].replace(/\u0000/g, "").replace(/^þÿ/, "").trim();
        if (name) names.push(name);
    }
    return names;
}

// EngineData 把每段文字的样式拆成 StyleRun；取覆盖非空白字符最多的那一段，
// 否则会读到只包含前导空格的样式段，字号偏大。
function pickDominantStyle(raw, text) {
    const start = raw.indexOf("/StyleRun");
    if (start < 0) return null;
    const section = raw.slice(start);
    const lenMatch = section.match(/\/RunLengthArray\s*\[([\d\s]+)\]/);
    const runStart = section.indexOf("/RunArray");
    if (!lenMatch || runStart < 0) return null;
    const lengths = lenMatch[1].trim().split(/\s+/).map(Number).filter(Number.isFinite);
    const chunks = section.slice(runStart, section.indexOf(lenMatch[0])).split("/StyleSheetData").slice(1);
    if (!chunks.length) return null;

    let pos = 0;
    let bestIndex = 0;
    let bestWeight = -1;
    for (let i = 0; i < lengths.length; i++) {
        const seg = text.slice(pos, pos + lengths[i]);
        pos += lengths[i];
        const weight = (seg.match(/\S/g) || []).length;
        if (weight > bestWeight) {
            bestWeight = weight;
            bestIndex = i;
        }
    }
    return chunks[Math.min(bestIndex, chunks.length - 1)];
}

function descriptorBounds(value) {
    if (!value || typeof value !== "object") return null;
    const left = descriptorNumber(descriptorValue(value, "Left", "Left ", "left"), NaN);
    const top = descriptorNumber(descriptorValue(value, "Top ", "Top", "top"), NaN);
    const right = descriptorNumber(descriptorValue(value, "Rght", "right"), NaN);
    const bottom = descriptorNumber(descriptorValue(value, "Btom", "bottom"), NaN);
    if (![left, top, right, bottom].every(Number.isFinite)) return null;
    return { left, top, right, bottom };
}

function transformBounds(bounds, transform) {
    if (!bounds || bounds.right <= bounds.left || bounds.bottom <= bounds.top) return null;
    const points = [
        [bounds.left, bounds.top],
        [bounds.right, bounds.top],
        [bounds.left, bounds.bottom],
        [bounds.right, bounds.bottom]
    ].map(([x, y]) => ({
        x: transform.xx * x + transform.yx * y + transform.tx,
        y: transform.xy * x + transform.yy * y + transform.ty
    }));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
        left: Math.floor(Math.min(...xs)),
        top: Math.floor(Math.min(...ys)),
        right: Math.ceil(Math.max(...xs)),
        bottom: Math.ceil(Math.max(...ys))
    };
}

function parseTypeToolText(data) {
    try {
        const r = new Reader(data);
        r.u16();
        const transform = {
            xx: r.f64(),
            xy: r.f64(),
            yx: r.f64(),
            yy: r.f64(),
            tx: r.f64(),
            ty: r.f64()
        };
        r.u16();
        const descVersion = r.u32();
        if (descVersion !== 16) return null;
        const descriptor = readDescriptorObject(r);
        const parsedText = descriptorValue(descriptor, "Txt ", "text");
        if (typeof parsedText !== "string" || !parsedText) return null;

        const raw = data.toString("latin1");
        const scale = Math.hypot(transform.xx, transform.xy) || Math.abs(transform.yy) || 1;
        const style = pickDominantStyle(raw, parsedText) || raw;

        const fontSize = engineNumber(style, "FontSize") || 24;
        const autoLeading = engineBool(style, "AutoLeading");
        const leading = engineNumber(style, "Leading");
        const lineHeight = (autoLeading === false && leading) ? leading : fontSize * 1.2;
        const fonts = engineFontNames(raw);
        const fontIndex = engineNumber(style, "Font");
        const isParagraph = engineNumber(raw, "ShapeType") === 1;

        const text = String(parsedText)
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .split("\n")
            .map((line) => line.replace(/^[ \t]+|[ \t]+$/g, ""))
            .join("\n")
            .replace(/^\n+|\n+$/g, "");

        // 段落排版必须使用文本框 bounds；boundingBox 只是当前字形的可见范围，
        // 用它作 CSS 宽度会产生额外换行，并使后续各行整体下移。
        const frameBounds = descriptorBounds(descriptorValue(descriptor, "bounds"));
        const glyphBounds = descriptorBounds(descriptorValue(descriptor, "boundingBox"));
        let localBounds = isParagraph ? frameBounds : glyphBounds;
        if (!localBounds) localBounds = isParagraph ? glyphBounds : frameBounds;

        // TySh 尾部还包含 warp descriptor 和一个备用矩形。
        try {
            if (r.remaining >= 6) {
                r.u16();
                const warpDescriptorVersion = r.u32();
                if (warpDescriptorVersion === 16) readDescriptorObject(r);
                if (!localBounds && r.remaining >= 16) {
                    localBounds = {
                        left: r.i32(),
                        top: r.i32(),
                        right: r.i32(),
                        bottom: r.i32()
                    };
                }
            }
        } catch (_) { /* 文本主体已解析，忽略不兼容的 warp 数据 */ }

        return {
            text,
            fontSize: Math.max(1, fontSize * scale),
            lineHeight: Math.max(1, lineHeight * scale),
            color: engineColor(style) || [255, 255, 255, 255],
            bold: engineBool(style, "FauxBold") === true,
            fontFamily: (fontIndex != null && fonts[fontIndex]) || fonts[0] || "",
            paragraph: isParagraph,
            layoutBounds: transformBounds(localBounds, transform),
            glyphBounds: transformBounds(glyphBounds || localBounds, transform)
        };
    } catch (_) {
        return null;
    }
}

function readId(r) {
    const len = r.u32();
    return r.str(len || 4);
}

function readUnicode(r) {
    const n = r.u32();
    return r.unicode(n);
}

function readDescriptorText(r) {
    readUnicode(r);
    readId(r);
    const count = r.u32();
    let text = null;
    for (let i = 0; i < count; i++) {
        const key = readId(r);
        const osType = r.str(4);
        const value = readOsType(r, osType);
        if (key === "Txt " && typeof value === "string") text = value;
        if (!text && value && typeof value === "object" && value.text) text = value.text;
    }
    return { text };
}

function readOsType(r, osType) {
    switch (osType) {
        case "TEXT":
            return readUnicode(r);
        case "enum":
            readId(r);
            return readId(r);
        case "long":
            return r.i32();
        case "comp":
            return r.u64();
        case "doub":
            r.skip(8);
            return 0;
        case "bool":
            return !!r.u8();
        case "UntF":
            r.skip(4 + 8);
            return 0;
        case "tdta": {
            const len = r.u32();
            r.skip(len);
            return null;
        }
        case "Objc":
        case "GlbO":
            return readDescriptorText(r);
        case "VlLs": {
            const n = r.u32();
            const items = [];
            for (let i = 0; i < n; i++) {
                const t = r.str(4);
                items.push(readOsType(r, t));
            }
            return items;
        }
        case "type":
        case "GlbC":
            return readId(r);
        case "alis":
        case "Pth ": {
            const len = r.u32();
            r.skip(len);
            return null;
        }
        case "obj ": {
            const n = r.u32();
            for (let i = 0; i < n; i++) {
                readId(r);
                const count = r.u32();
                for (let j = 0; j < count; j++) r.str(4);
            }
            return null;
        }
        default:
            throw new Error(`未知 OSType ${osType}`);
    }
}

// lfx2/lmfx 使用 Photoshop Descriptor 保存图层效果。这里保留单位和枚举，
// 再转换为稳定、便于其他运行时消费的 JSON，而不是把 PSD 内部字段直接泄露出去。
function readDescriptorObject(r) {
    const name = readUnicode(r);
    const classId = readId(r);
    const count = r.u32();
    const out = { _name: name, _class: classId };
    for (let i = 0; i < count; i++) {
        const key = readId(r);
        const osType = r.str(4);
        out[key] = readDescriptorValue(r, osType);
    }
    return out;
}

function readDescriptorValue(r, osType) {
    switch (osType) {
        case "TEXT": return readUnicode(r);
        case "enum": return { type: readId(r), value: readId(r) };
        case "long": return r.i32();
        case "comp": return r.u64();
        case "doub": return r.f64();
        case "bool": return !!r.u8();
        case "UntF": return { unit: r.str(4), value: r.f64() };
        case "UnFl": return { unit: r.str(4), value: r.f32() };
        case "Objc":
        case "GlbO":
            return readDescriptorObject(r);
        case "VlLs": {
            const count = r.u32();
            const list = [];
            for (let i = 0; i < count; i++) list.push(readDescriptorValue(r, r.str(4)));
            return list;
        }
        case "type":
        case "GlbC":
            return readId(r);
        case "tdta":
        case "alis":
        case "Pth ": {
            const len = r.u32();
            return r.bytes(len);
        }
        default:
            throw new Error(`未知效果 OSType ${osType}`);
    }
}

function descriptorValue(obj, ...keys) {
    if (!obj || typeof obj !== "object") return undefined;
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
    }
    return undefined;
}

function descriptorNumber(value, fallback = 0) {
    if (Number.isFinite(value)) return value;
    if (value && Number.isFinite(value.value)) return value.value;
    return fallback;
}

function descriptorEnum(value, fallback = "") {
    if (typeof value === "string") return value;
    return value && typeof value.value === "string" ? value.value : fallback;
}

function effectEnabled(effect) {
    const enabled = descriptorValue(effect, "enab", "enabled");
    return enabled == null ? true : !!enabled;
}

function normalizeBlendMode(value) {
    const mode = descriptorEnum(value, "Nrml").trim();
    const modes = {
        Nrml: "normal", Mltp: "multiply", Scrn: "screen", Ovrl: "overlay",
        SftL: "soft-light", HrdL: "hard-light", Drkn: "darken", Lghn: "lighten",
        Dfrn: "difference", Xclu: "exclusion", CDdg: "color-dodge", CBrn: "color-burn"
    };
    return modes[mode] || mode || "normal";
}

function normalizeEffectColor(value, opacity = 100) {
    if (!value || typeof value !== "object") return null;
    const r = descriptorNumber(descriptorValue(value, "Rd  ", "Rd ", "red"), NaN);
    const g = descriptorNumber(descriptorValue(value, "Grn ", "Grn", "green"), NaN);
    const b = descriptorNumber(descriptorValue(value, "Bl  ", "Bl ", "blue"), NaN);
    if (![r, g, b].every(Number.isFinite)) return null;
    return [
        Math.round(Math.max(0, Math.min(255, r))),
        Math.round(Math.max(0, Math.min(255, g))),
        Math.round(Math.max(0, Math.min(255, b))),
        Math.round(Math.max(0, Math.min(100, opacity)) * 2.55)
    ];
}

function interpolateStops(stops, location, key, fallback) {
    if (!stops.length) return fallback;
    if (location <= stops[0].location) return stops[0][key];
    for (let i = 1; i < stops.length; i++) {
        if (location <= stops[i].location) {
            const a = stops[i - 1];
            const b = stops[i];
            const span = b.location - a.location || 1;
            return a[key] + (b[key] - a[key]) * ((location - a.location) / span);
        }
    }
    return stops[stops.length - 1][key];
}

function normalizeGradient(value, effectOpacity = 100) {
    if (!value || typeof value !== "object") return null;
    const rawColors = descriptorValue(value, "Clrs", "colors") || [];
    const rawTransparency = descriptorValue(value, "Trns", "transparency") || [];
    const alphaStops = rawTransparency.map((stop) => ({
        location: descriptorNumber(descriptorValue(stop, "Lctn", "location")) / 4096,
        opacity: descriptorNumber(descriptorValue(stop, "Opct", "opacity"), 100)
    })).sort((a, b) => a.location - b.location);
    const stops = rawColors.map((stop) => {
        const location = descriptorNumber(descriptorValue(stop, "Lctn", "location")) / 4096;
        const alpha = interpolateStops(alphaStops, location, "opacity", 100) * effectOpacity / 100;
        const color = normalizeEffectColor(descriptorValue(stop, "Clr ", "color"), alpha);
        return color ? {
            location: Math.max(0, Math.min(1, location)),
            midpoint: descriptorNumber(descriptorValue(stop, "Mdpn", "midpoint"), 50),
            color
        } : null;
    }).filter(Boolean).sort((a, b) => a.location - b.location);
    return stops.length ? { name: descriptorValue(value, "Nm  ", "name") || "", stops } : null;
}

function normalizeCommonEffect(effect) {
    const opacity = descriptorNumber(descriptorValue(effect, "Opct", "opacity"), 100);
    return {
        enabled: effectEnabled(effect),
        blendMode: normalizeBlendMode(descriptorValue(effect, "Md  ", "mode")),
        opacity
    };
}

function normalizeShadowEffect(effect) {
    const out = normalizeCommonEffect(effect);
    out.color = normalizeEffectColor(descriptorValue(effect, "Clr ", "color"), out.opacity);
    out.angle = descriptorNumber(descriptorValue(effect, "lagl", "Angl", "angle"), 120);
    out.distance = descriptorNumber(descriptorValue(effect, "Dstn", "distance"));
    out.blur = descriptorNumber(descriptorValue(effect, "blur", "blurRadius"));
    out.spread = descriptorNumber(descriptorValue(effect, "Ckmt", "chokeMatte"));
    return out;
}

function normalizeGlowEffect(effect) {
    const out = normalizeCommonEffect(effect);
    out.color = normalizeEffectColor(descriptorValue(effect, "Clr ", "color"), out.opacity);
    out.blur = descriptorNumber(descriptorValue(effect, "blur", "blurRadius"));
    out.spread = descriptorNumber(descriptorValue(effect, "Ckmt", "chokeMatte"));
    const gradient = descriptorValue(effect, "Grad", "Grad ", "gradient");
    if (gradient) out.gradient = normalizeGradient(gradient, out.opacity);
    return out;
}

function normalizeStrokeEffect(effect) {
    const out = normalizeCommonEffect(effect);
    out.size = descriptorNumber(descriptorValue(effect, "Sz  ", "size"));
    const positions = { OutF: "outside", InsF: "inside", CtrF: "center" };
    const position = descriptorEnum(descriptorValue(effect, "Styl", "style"), "OutF").trim();
    out.position = positions[position] || position;
    const fillTypes = { GrFl: "gradient", SClr: "color", Ptrn: "pattern" };
    const fillType = descriptorEnum(descriptorValue(effect, "PntT", "paintType"), "").trim();
    out.fillType = fillTypes[fillType] || fillType || "color";
    out.color = normalizeEffectColor(descriptorValue(effect, "Clr ", "color"), out.opacity);
    const gradient = descriptorValue(effect, "Grad", "Grad ", "gradient");
    if (gradient) {
        out.angle = descriptorNumber(descriptorValue(effect, "Angl", "angle"), 90);
        out.scale = descriptorNumber(descriptorValue(effect, "Scl ", "scale"), 100);
        out.reverse = !!descriptorValue(effect, "Rvrs", "reverse");
        out.type = descriptorEnum(descriptorValue(effect, "Type", "type"), "Lnr ").trim();
        out.gradient = normalizeGradient(gradient, out.opacity);
    }
    return out;
}

function normalizeGradientEffect(effect) {
    const out = normalizeCommonEffect(effect);
    out.angle = descriptorNumber(descriptorValue(effect, "Angl", "angle"), 90);
    out.scale = descriptorNumber(descriptorValue(effect, "Scl ", "scale"), 100);
    out.reverse = !!descriptorValue(effect, "Rvrs", "reverse");
    out.type = descriptorEnum(descriptorValue(effect, "Type", "type"), "Lnr ").trim();
    out.gradient = normalizeGradient(descriptorValue(effect, "Grad", "Grad ", "gradient"), out.opacity);
    return out;
}

function firstEffect(root, ...keys) {
    const value = descriptorValue(root, ...keys);
    return Array.isArray(value) ? value.find(effectEnabled) || value[0] : value;
}

function normalizeLayerEffects(root) {
    const effects = {};
    const stroke = firstEffect(root, "FrFX", "frameFX", "frameFXMulti");
    const gradient = firstEffect(root, "GrFl", "gradientFill", "gradientFillMulti");
    const dropShadow = firstEffect(root, "DrSh", "dropShadow", "dropShadowMulti");
    const innerShadow = firstEffect(root, "IrSh", "innerShadow", "innerShadowMulti");
    const outerGlow = firstEffect(root, "OrGl", "outerGlow");
    const innerGlow = firstEffect(root, "IrGl", "innerGlow");
    const colorOverlay = firstEffect(root, "SoFi", "solidFill", "solidFillMulti");
    if (stroke) effects.stroke = normalizeStrokeEffect(stroke);
    if (gradient) effects.gradientOverlay = normalizeGradientEffect(gradient);
    if (dropShadow) effects.dropShadow = normalizeShadowEffect(dropShadow);
    if (innerShadow) effects.innerShadow = normalizeShadowEffect(innerShadow);
    if (outerGlow) effects.outerGlow = normalizeGlowEffect(outerGlow);
    if (innerGlow) effects.innerGlow = normalizeGlowEffect(innerGlow);
    if (colorOverlay) {
        const common = normalizeCommonEffect(colorOverlay);
        common.color = normalizeEffectColor(descriptorValue(colorOverlay, "Clr ", "color"), common.opacity);
        effects.colorOverlay = common;
    }
    return Object.keys(effects).length ? effects : null;
}

function parseObjectLayerEffects(data) {
    try {
        const r = new Reader(data);
        r.u32(); // object effects version
        const descriptorVersion = r.u32();
        if (descriptorVersion !== 16) return null;
        return normalizeLayerEffects(readDescriptorObject(r));
    } catch (e) {
        console.warn(`⚠️ 图层效果解析失败: ${e.message}`);
        return null;
    }
}

function parseChannelImages(buf, layer) {
    const r = new Reader(buf);
    r.pos = layer.channelOffset || 0;
    const images = {};
    for (const ch of layer.channelInfo) {
        if (ch.length < 2) {
            images[ch.id] = Buffer.alloc(0);
            continue;
        }
        const compression = r.u16();
        const dataLen = ch.length - 2;
        const data = r.bytes(dataLen);
        let cw = layer.width;
        let chh = layer.height;
        if ((ch.id === -2 || ch.id === -3) && layer.mask && layer.mask.width > 0 && layer.mask.height > 0) {
            cw = layer.mask.width;
            chh = layer.mask.height;
        }
        images[ch.id] = decodeChannel(compression, data, cw, chh, layer.isPsb);
    }
    return images;
}

function decodeChannel(compression, data, width, height, isPsb) {
    if (width <= 0 || height <= 0) return Buffer.alloc(0);
    if (compression === 0) {
        return Buffer.from(data.subarray(0, width * height));
    }
    if (compression !== 1) {
        return Buffer.alloc(width * height);
    }

    const countSize = isPsb ? 4 : 2;
    const headerSize = height * countSize;
    if (data.length < headerSize) return Buffer.alloc(width * height);

    const out = Buffer.alloc(width * height);
    let src = headerSize;
    let dst = 0;
    for (let y = 0; y < height; y++) {
        const rowLen = isPsb ? data.readUInt32BE(y * 4) : data.readUInt16BE(y * 2);
        const rowEnd = src + rowLen;
        let x = 0;
        while (src < rowEnd && x < width && src < data.length) {
            const n = data.readInt8(src);
            src += 1;
            if (n >= 0) {
                const count = n + 1;
                for (let i = 0; i < count && src < data.length && x < width; i++, x++, src++) {
                    out[dst++] = data[src];
                }
            } else if (n !== -128) {
                const count = 1 - n;
                const val = src < data.length ? data[src] : 0;
                src += 1;
                for (let i = 0; i < count && x < width; i++, x++) {
                    out[dst++] = val;
                }
            }
        }
        src = rowEnd;
        while (x < width) {
            out[dst++] = 0;
            x++;
        }
    }
    return out;
}

function layerHasPixels(layer) {
    if (layer.width <= 0 || layer.height <= 0) return false;
    return (layer.channelInfo || []).some((ch) => ch.length > 2);
}

function applyMaskToRgba(rgba, layer, maskPixels, maskInfo) {
    if (!maskInfo || maskInfo.disabled) return;
    const w = layer.width;
    const h = layer.height;
    const mw = maskInfo.width || 0;
    const mh = maskInfo.height || 0;
    const maskLeft = maskInfo.relative ? (layer.left || 0) + maskInfo.left : maskInfo.left;
    const maskTop = maskInfo.relative ? (layer.top || 0) + maskInfo.top : maskInfo.top;
    const maskRight = maskLeft + mw;
    const maskBottom = maskTop + mh;
    const invert = maskInfo.invert;
    const def = maskInfo.defaultColor || 0;

    for (let y = 0; y < h; y++) {
        const docY = (layer.top || 0) + y;
        for (let x = 0; x < w; x++) {
            const docX = (layer.left || 0) + x;
            let m = def;
            if (maskPixels && mw > 0 && mh > 0 &&
                docX >= maskLeft && docX < maskRight &&
                docY >= maskTop && docY < maskBottom) {
                m = maskPixels[(docY - maskTop) * mw + (docX - maskLeft)] || 0;
            }
            if (invert) m = 255 - m;
            const o = (y * w + x) * 4 + 3;
            rgba[o] = Math.round((rgba[o] * m) / 255);
        }
    }
}

function groupMaskPixels(buf, group) {
    if (group._maskPixels === undefined) {
        try {
            group._maskPixels = parseChannelImages(buf, group)[-2] || null;
        } catch (_) {
            group._maskPixels = null;
        }
    }
    return group._maskPixels;
}

function composeLayerRgba(buf, layer) {
    const channelData = parseChannelImages(buf, layer);
    const w = layer.width;
    const h = layer.height;
    const data = Buffer.alloc(w * h * 4);
    const rCh = channelData[0] || Buffer.alloc(w * h);
    const gCh = channelData[1] || rCh;
    const bCh = channelData[2] || rCh;
    const aCh = channelData[-1] || channelData[0xffff] || Buffer.alloc(w * h, 255);

    for (let i = 0; i < w * h; i++) {
        const o = i * 4;
        data[o] = rCh[i] || 0;
        data[o + 1] = gCh[i] || 0;
        data[o + 2] = bCh[i] || 0;
        data[o + 3] = aCh[i] != null ? aCh[i] : 255;
    }
    applyMaskToRgba(data, layer, channelData[-2], layer.mask);
    for (const group of layer._groupMasks || []) {
        applyMaskToRgba(data, layer, groupMaskPixels(buf, group), group.mask);
    }
    return { data, width: w, height: h };
}

function trimRgba(data, width, height, alphaMin) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] >= alphaMin) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) return null;

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (w === width && h === height) {
        return { data, width, height, cropLeft: 0, cropTop: 0 };
    }

    const out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
        const src = ((minY + y) * width + minX) * 4;
        data.copy(out, y * w * 4, src, src + w * 4);
    }
    return { data: out, width: w, height: h, cropLeft: minX, cropTop: minY };
}

function prepareLayerImages(buf, layers) {
    for (const layer of layers) {
        if (layer.dividerType) continue;
        if (layer.hidden) continue;
        if (layer.text) continue;
        if (!layerHasPixels(layer)) continue;
        try {
            const rgba = composeLayerRgba(buf, layer);
            const img = TRIM_TRANSPARENT
                ? trimRgba(rgba.data, rgba.width, rgba.height, TRIM_ALPHA_MIN)
                : { data: rgba.data, width: rgba.width, height: rgba.height, cropLeft: 0, cropTop: 0 };
            if (!img) {
                layer.width = 0;
                layer.height = 0;
                layer._png = null;
                continue;
            }
            layer.left = (layer.left || 0) + img.cropLeft;
            layer.top = (layer.top || 0) + img.cropTop;
            layer.width = img.width;
            layer.height = img.height;
            layer.right = layer.left + layer.width;
            layer.bottom = layer.top + layer.height;
            layer._png = img;
        } catch (e) {
            console.warn(`⚠️ 图层像素处理失败 ${layer.name}: ${e.message}`);
        }
    }
}

function exportLayerPng(layer, outPath) {
    const img = layer._png;
    if (!img || img.width <= 0 || img.height <= 0) return;
    const png = new PNG({ width: img.width, height: img.height });
    img.data.copy(png.data);
    fs.writeFileSync(outPath, PNG.sync.write(png));
}

function buildTree(layers) {
    const root = { children: [], name: "ROOT" };
    const stack = [root];

    for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        const type = layer.dividerType;
        if (type === 1 || type === 2) {
            const group = { ...layer, children: [], isGroup: true };
            stack[stack.length - 1].children.push(group);
            stack.push(group);
        } else if (type === 3) {
            if (stack.length > 1) stack.pop();
        } else {
            stack[stack.length - 1].children.push({ ...layer, children: [], isGroup: false });
        }
    }
    return root.children;
}

// 组上的图层蒙版会裁剪组内所有子图层，逐层记录祖先蒙版供合成时叠加。
function assignAncestorMasks(layers) {
    const stack = [];
    for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        const type = layer.dividerType;
        const inherited = stack.length ? stack[stack.length - 1] : [];
        if (type === 1 || type === 2) {
            const usable = layer.mask && !layer.mask.disabled && layer.mask.width > 0 && layer.mask.height > 0;
            stack.push(usable ? inherited.concat([layer]) : inherited);
        } else if (type === 3) {
            if (stack.length) stack.pop();
        } else if (inherited.length) {
            layer._groupMasks = inherited;
        }
    }
}

function hideDescendantsOfHiddenGroups(layers) {
    const hiddenStack = [];
    for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        const type = layer.dividerType;
        const parentHidden = hiddenStack.length ? hiddenStack[hiddenStack.length - 1] : false;
        if (type === 1 || type === 2) {
            const hidden = parentHidden || !!layer.hidden;
            layer.hidden = hidden;
            hiddenStack.push(hidden);
        } else if (type === 3) {
            if (hiddenStack.length) hiddenStack.pop();
        } else if (parentHidden) {
            layer.hidden = true;
        }
    }
}

function unionGroupBounds(node) {
    if (!node.isGroup || !node.children || !node.children.length) return;
    for (const child of node.children) unionGroupBounds(child);

    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const child of node.children) {
        if (child.hidden) continue;
        if ((child.width || 0) <= 0 && (child.height || 0) <= 0) continue;
        left = Math.min(left, child.left || 0);
        top = Math.min(top, child.top || 0);
        right = Math.max(right, (child.left || 0) + (child.width || 0));
        bottom = Math.max(bottom, (child.top || 0) + (child.height || 0));
    }
    if (left !== Infinity) {
        node.left = left;
        node.top = top;
        node.width = right - left;
        node.height = bottom - top;
        node.right = right;
        node.bottom = bottom;
    }
}

function walkLayer(layer, docHeight, usedNames) {
    if (layer.hidden) return null;

    const name = uniqueName(safeFileName(layer.name), usedNames);
    const width = layer.width || 0;
    const height = layer.height || 0;
    const opacity = Number.isFinite(layer.opacity)
        ? Number((layer.opacity / 255).toFixed(3))
        : 1;

    const base = {
        name,
        visible: !layer.hidden,
        opacity,
        x: layer.left || 0,
        y: psdYToCocosY(layer.top || 0, height, docHeight),
        width,
        height,
        children: [],
        type: "node"
    };

    if (layer.isGroup) {
        base.type = "group";
        if (name.includes("#raster#")) {
            base.type = "sprite";
            base.spriteFramePath = `${RESOURCES_SUB_PATH}/${name}.png`;
            base.children = [];
            return base;
        }
        const childNames = new Set();
        for (const child of layer.children || []) {
            if (!child.isGroup && (child.width <= 0 || child.height <= 0) && !child.text) continue;
            const childNode = walkLayer(child, docHeight, childNames);
            if (childNode) base.children.push(childNode);
        }
        if (!base.children.length) return null;
        cleanGroupLabelText(base);
        return base;
    }

    if (layer.text) {
        const t = typeof layer.text === "string" ? { text: layer.text } : layer.text;
        base.type = "label";
        base.text = t.text || "";
        base.fontSize = Math.max(1, Math.round(t.fontSize || 24));
        base.lineHeight = Math.max(1, Math.round(t.lineHeight || base.fontSize * 1.2));
        base.color = t.color || [255, 255, 255, 255];
        if (t.bold) base.bold = true;
        if (t.fontFamily) base.fontFamily = t.fontFamily;
        // ShapeType=1 也可能用于很窄的编号列；只有内容确实需要换行时才启用段落排版，
        // 避免把 “额外球：” 这类单行标题当成 1341px 宽段落，导致渐变按整框映射。
        const textContent = String(t.text || "");
        const estLineWidth = [...textContent.replace(/\n/g, "")].length * base.fontSize * 0.92;
        if (t.paragraph && width >= base.fontSize * 4 &&
            (textContent.indexOf("\n") >= 0 || estLineWidth > width * 0.92)) {
            base.paragraph = true;
        }
        if (layer.effects) base.effects = layer.effects;
        return base;
    }

    if (layer._png) {
        base.type = "sprite";
        if (layer.effects) base.effects = layer.effects;
        const pngName = uniquePngName(name);
        if (EXPORT_PNG) {
            try {
                exportLayerPng(layer, path.join(EXPORT_DIR, pngName));
            } catch (e) {
                console.warn(`⚠️ PNG 导出失败 ${pngName}: ${e.message}`);
            }
        }
        base.spriteFramePath = `${RESOURCES_SUB_PATH}/${pngName}`;
        return base;
    }

    return null;
}

// 节点名只在同级去重，但 PNG 全部写进同一目录，需要全局唯一的文件名。
function uniquePngName(base) {
    let file = `${base}.png`;
    let i = 2;
    while (USED_PNG_NAMES.has(file)) file = `${base}_${i++}.png`;
    USED_PNG_NAMES.add(file);
    return file;
}

function uniqueName(name, used) {
    if (!used.has(name)) {
        used.add(name);
        return name;
    }
    let i = 2;
    while (used.has(`${name}_${i}`)) i++;
    const next = `${name}_${i}`;
    used.add(next);
    return next;
}

(async function main() {
    try {
        fs.ensureDirSync(PSD_DIR);
        const { htmlOnly, fileArg } = parseCliArgs();
        const psdFile = resolvePsdFile(fileArg);
        const rootName = safeFileName(path.parse(psdFile).name);
        const namedDir = path.join(EXPORT_ROOT, rootName);

        if (!fs.existsSync(psdFile)) {
            throw new Error(`找不到文件: ${psdFile}`);
        }

        EXPORT_DIR = nextExportDir(namedDir);

        console.log(`📖 读取 ${psdFile} ...`);
        const buf = fs.readFileSync(psdFile);
        const psd = parsePsd(buf);
        hideDescendantsOfHiddenGroups(psd.layers);
        assignAncestorMasks(psd.layers);
        console.log(`✂️ 裁剪图层透明边 ...`);
        prepareLayerImages(buf, psd.layers);
        console.log(`🌳 图层记录 ${psd.layers.length}，开始构建节点树...`);
        const children = buildTree(psd.layers);
        for (const child of children) unionGroupBounds(child);

        const rootDesc = {
            name: rootName,
            visible: true,
            opacity: 1,
            x: 0,
            y: 0,
            width: psd.width,
            height: psd.height,
            children: [],
            type: "node"
        };

        const used = new Set();
        for (const child of children) {
            if (!child.isGroup && (child.width <= 0 || child.height <= 0) && !child.text) continue;
            const childNode = walkLayer(child, psd.height, used);
            if (childNode) rootDesc.children.push(childNode);
        }

        const jsonOutPath = path.join(EXPORT_DIR, "ui_desc.json");
        fs.writeJSONSync(jsonOutPath, rootDesc, { spaces: 2 });

        let htmlPath = "";
        if (EXPORT_HTML || htmlOnly) htmlPath = writePreviewHtml(rootDesc, EXPORT_DIR);

        console.log(`✅ 解析完成  (${psd.isPsb ? "PSB" : "PSD"}  ${psd.width}x${psd.height}  图层记录 ${psd.layers.length}  根子节点 ${rootDesc.children.length})`);
        console.log(`📄 JSON: ${jsonOutPath}`);
        console.log(`🖼️ PNG: ${EXPORT_DIR}`);
        if (htmlPath) console.log(`🌐 HTML: ${htmlPath}`);
        console.log(`📁 PSD: ${psdFile}`);
        console.log(`💡提示：`);
        console.log(`   1.通过参数传入 PSD/PSB，例如: node psd2desc.js bingoRule.psb`);
        console.log(`   2.组名带 #raster# 的组不会导出图片，需要你PS手动盖印导出 <组名>.png 放入 resources/${RESOURCES_SUB_PATH}/`);
        console.log(`   3.把 ${EXPORT_DIR}/ 下所有png复制到 Cocos assets/resources/${RESOURCES_SUB_PATH}/`);
        console.log(`   4.使用编辑器扩展 main.ts 读取 ${jsonOutPath} 生成prefab`);
        console.log(`   5.浏览器打开 ${path.join(EXPORT_DIR, "index.html")} 预览`);
    } catch (err) {
        console.error("❌解析失败：", err);
        process.exitCode = 1;
    }
})();

