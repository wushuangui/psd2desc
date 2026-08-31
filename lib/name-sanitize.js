"use strict";

const crypto = require("crypto");
const { pinyin } = require("pinyin-pro");

const MAX_LABEL_NAME_LEN = 40;
const MAX_LABEL_WORDS = 4;

const CJK_NAME_TERMS = [
    ["智能对象", "smartobject"],
    ["矢量蒙版", "vectormask"],
    ["圆角矩形", "roundrect"],
    ["图层样式", "layerstyle"],
    ["颜色叠加", "coloroverlay"],
    ["渐变叠加", "gradientoverlay"],
    ["颜色填充", "colorfill"],
    ["渐变填充", "gradientfill"],
    ["图案填充", "patternfill"],
    ["外发光", "outerglow"],
    ["内发光", "innerglow"],
    ["内阴影", "innershadow"],
    ["投影", "dropshadow"],
    ["图层", "layer"],
    ["图像", "image"],
    ["组合", "group"],
    ["拷贝", "copy"],
    ["副本", "copy"],
    ["形状", "shape"],
    ["矩形", "rect"],
    ["椭圆", "ellipse"],
    ["圆形", "circle"],
    ["多边形", "polygon"],
    ["直线", "line"],
    ["箭头", "arrow"],
    ["文字", "text"],
    ["文本", "text"],
    ["背景", "bg"],
    ["前景", "fg"],
    ["蒙版", "mask"],
    ["路径", "path"],
    ["矢量", "vector"],
    ["填充", "fill"],
    ["描边", "stroke"],
    ["效果", "effect"],
    ["光效", "glow"],
    ["阴影", "shadow"],
    ["高光", "highlight"],
    ["图标", "icon"],
    ["按钮", "btn"],
    ["标题", "title"],
    ["关闭", "close"],
    ["打开", "open"],
    ["返回", "back"],
    ["确定", "ok"],
    ["取消", "cancel"],
    ["提示", "tip"],
    ["规则", "rule"],
    ["奖励", "reward"],
    ["装饰", "deco"],
    ["边框", "frame"],
    ["底图", "base"],
    ["组", "group"]
];

function toHalfWidth(str) {
    return String(str).replace(/[\uFF01-\uFF5E]/g, (ch) =>
        String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
    ).replace(/\u3000/g, " ");
}

function hasNonAscii(str) {
    return /[^\x00-\x7F]/.test(str);
}

function preprocessName(str) {
    let s = toHalfWidth(String(str || "")).replace(/#raster#/gi, "").trim();
    if (!s) return "";

    for (const [cn, en] of CJK_NAME_TERMS) {
        if (s.indexOf(cn) >= 0) s = s.split(cn).join(" " + en + " ");
    }

    if (hasNonAscii(s)) {
        try {
            s = pinyin(s, {
                toneType: "none",
                type: "string",
                separator: " ",
                nonZh: "consecutive",
                v: true
            });
        } catch (_) {
            s = s.replace(/[^\x00-\x7F\s]/g, " ");
        }
    }
    return s;
}

function splitWords(str) {
    return preprocessName(str).split(/[^a-zA-Z0-9]+/).filter(Boolean);
}

function wordsToPascal(words) {
    return words.map((word) => {
        const lower = word.toLowerCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
    }).join("");
}

function shortHash(str) {
    return crypto.createHash("md5").update(String(str)).digest("hex").slice(0, 6);
}

function safeFileName(str) {
    const words = splitWords(str);
    if (!words.length) return "unnamed";
    return words.join("") || "unnamed";
}

function labelNameFromRaw(raw) {
    const words = splitWords(raw);
    if (!words.length) return "label";

    const full = wordsToPascal(words);
    if (full.length <= MAX_LABEL_NAME_LEN) return full;

    const short = wordsToPascal(words.slice(0, MAX_LABEL_WORDS));
    const hash = shortHash(raw);
    const base = short.length > MAX_LABEL_NAME_LEN - hash.length
        ? short.slice(0, MAX_LABEL_NAME_LEN - hash.length)
        : short;
    return `${base}${hash}`;
}

function uniqueAsciiName(name, used) {
    if (!used.has(name)) {
        used.add(name);
        return name;
    }
    let i = 2;
    while (used.has(`${name}${i}`)) i++;
    const next = `${name}${i}`;
    used.add(next);
    return next;
}

function sanitizeLabelName(raw, used) {
    return uniqueAsciiName(labelNameFromRaw(raw), used);
}

module.exports = {
    safeFileName,
    uniqueAsciiName,
    sanitizeLabelName,
    labelNameFromRaw
};
