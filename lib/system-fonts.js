"use strict";

const fs = require("fs-extra");
const path = require("path");

const FONT_EXTENSIONS = [".ttf", ".ttc", ".otf"];

function getWindowsFontsDir() {
    if (process.platform !== "win32") return null;
    const dir = path.join(process.env.WINDIR || "C:\\Windows", "Fonts");
    return fs.existsSync(dir) ? dir : null;
}

function findSystemFontByBaseName(baseName, fontsDir) {
    const dir = fontsDir || getWindowsFontsDir();
    if (!dir || !baseName) return null;

    const lower = String(baseName).toLowerCase();
    let entries;
    try {
        entries = fs.readdirSync(dir);
    } catch (err) {
        return null;
    }

    for (const ext of FONT_EXTENSIONS) {
        const candidate = lower + ext;
        const found = entries.find((name) => name.toLowerCase() === candidate);
        if (found) return path.join(dir, found);
    }
    return null;
}

function copySystemFontTo(destAbsPath) {
    const dest = path.resolve(destAbsPath);
    if (fs.existsSync(dest)) {
        return { copied: false, reason: "exists" };
    }

    const baseName = path.basename(dest, path.extname(dest));
    const source = findSystemFontByBaseName(baseName);
    if (!source) {
        return { copied: false, reason: "not-found" };
    }

    fs.ensureDirSync(path.dirname(dest));
    fs.copyFileSync(source, dest);
    return { copied: true, source, dest };
}

module.exports = {
    getWindowsFontsDir,
    findSystemFontByBaseName,
    copySystemFontTo
};
