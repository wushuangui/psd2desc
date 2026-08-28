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
    }

    _addMissing(item) {
        if (this._missingSet.has(item)) return;
        this._missingSet.add(item);
        this.missing.push(item);
    }

    readMeta(relPath) {
        const metaPath = path.join(this.assetsRoot, relPath + ".meta");
        if (!fs.existsSync(metaPath)) {
            this._addMissing(relPath);
            return null;
        }
        try {
            return fs.readJsonSync(metaPath);
        } catch (err) {
            this._addMissing(`${relPath} (${err.message})`);
            return null;
        }
    }

    spriteFrameUuid(spriteFramePath) {
        const normalized = String(spriteFramePath || "").replace(/\\/g, "/");
        const rel = normalized.replace(/\.png$/i, "");
        const base = path.basename(rel);
        const meta = this.readMeta(rel + ".png");
        if (!meta) return null;

        const sub = meta.subMetas && meta.subMetas[base];
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
            this.fontWarnings.push(`未映射字体: ${fontFamily}`);
            return null;
        }
        const normalized = rel.replace(/\\/g, "/");
        const meta = this.readMeta(normalized);
        if (!meta || !meta.uuid) {
            this._addMissing(normalized);
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
