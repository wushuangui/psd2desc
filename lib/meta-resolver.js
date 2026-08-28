"use strict";

const fs = require("fs-extra");
const path = require("path");

class MetaResolver {
    constructor(assetsRoot, fontMapPath) {
        this.assetsRoot = path.resolve(assetsRoot);
        this.fontMap = fs.existsSync(fontMapPath)
            ? fs.readJsonSync(fontMapPath)
            : {};
        this.missing = [];
        this.fontWarnings = [];
        this._missingSet = new Set();
        this._fontWarningSet = new Set();
    }

    _addMissing(item) {
        if (this._missingSet.has(item)) return;
        this._missingSet.add(item);
        this.missing.push(item);
    }

    _addFontWarning(message) {
        if (this._fontWarningSet.has(message)) return;
        this._fontWarningSet.add(message);
        this.fontWarnings.push(message);
    }

    readMeta(relPath, options) {
        const soft = options && options.soft;
        const metaPath = path.join(this.assetsRoot, relPath + ".meta");
        if (!fs.existsSync(metaPath)) {
            if (!soft) this._addMissing(relPath);
            return null;
        }
        try {
            return fs.readJsonSync(metaPath);
        } catch (err) {
            const item = `${relPath} (${err.message})`;
            if (!soft) this._addMissing(item);
            return null;
        }
    }

    _findSpriteFrameSubMeta(meta, baseName) {
        if (!meta || !meta.subMetas) return null;

        const byName = meta.subMetas[baseName];
        if (byName && byName.uuid) return byName;

        let fallback = null;
        for (const sub of Object.values(meta.subMetas)) {
            if (sub.importer !== "sprite-frame" || !sub.uuid) continue;
            if (sub.displayName === baseName || sub.name === "spriteFrame") return sub;
            if (!fallback) fallback = sub;
        }
        return fallback;
    }

    spriteFrameUuid(spriteFramePath) {
        const normalized = String(spriteFramePath || "").replace(/\\/g, "/");
        const rel = normalized.replace(/\.png$/i, "");
        const base = path.basename(rel);
        const meta = this.readMeta(rel + ".png");
        if (!meta) return null;

        const sub = this._findSpriteFrameSubMeta(meta, base);
        if (sub && sub.uuid) return sub.uuid;

        // Some older meta layouts store sprite frame at top level.
        if (meta.uuid && meta.type === "sprite-frame") return meta.uuid;

        this._addMissing(`${rel}.png (subMeta ${base})`);
        return null;
    }

    fontUuid(fontFamily) {
        if (!fontFamily) return null;
        const rel = this.fontMap[fontFamily];
        if (!rel) {
            this._addFontWarning(`未映射字体，将使用默认字体: ${fontFamily}`);
            return null;
        }
        const normalized = rel.replace(/\\/g, "/");
        const abs = path.join(this.assetsRoot, normalized);
        if (!fs.existsSync(abs)) {
            this._addFontWarning(`缺少字体文件，将使用默认字体: ${fontFamily} (${normalized})`);
            return null;
        }
        const meta = this.readMeta(normalized, { soft: true });
        if (!meta || !meta.uuid) {
            this._addFontWarning(`缺少字体 meta，将使用默认字体: ${fontFamily} (${normalized})`);
            return null;
        }
        return meta.uuid;
    }

    collectSpritePaths(ir, out) {
        if (ir.kind === "sprite" && ir.spriteFramePath) {
            out.push(ir.spriteFramePath);
        }
        for (const child of ir.children || []) {
            this.collectSpritePaths(child, out);
        }
    }

    validateIr(ir) {
        const spritePaths = [];
        this.collectSpritePaths(ir, spritePaths);
        for (const p of spritePaths) {
            this.spriteFrameUuid(p);
        }
        this.walkFonts(ir);
        return {
            missing: this.missing.slice(),
            fontWarnings: this.fontWarnings.slice()
        };
    }

    walkFonts(ir) {
        if (ir.kind === "label" && ir.label && ir.label.fontFamily) {
            this.fontUuid(ir.label.fontFamily);
        }
        for (const child of ir.children || []) {
            this.walkFonts(child);
        }
    }
}

module.exports = { MetaResolver };
