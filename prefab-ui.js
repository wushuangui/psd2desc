#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");
const { convertToPrefab } = require("./desc2cocos");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const PSD_DIR = path.join(ROOT, "psd");
const DEFAULT_FONT_MAP = path.join(ROOT, "config", "font-map.json");
const DEFAULT_TEXTURE_SUB_PATH = "psd_out";
const PORT = Number(process.env.PREFAB_UI_PORT) || 3456;

function sendJson(res, status, body) {
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify(body, null, 2));
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
    res.writeHead(status, { "Content-Type": contentType });
    res.end(body);
}

async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw);
}

function normalizeRelPath(p) {
    return String(p || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function resolveAssetDir(dirPath, assetsRoot) {
    const raw = String(dirPath || "").trim();
    if (!raw) return { abs: "", rel: "" };

    const assets = path.resolve(assetsRoot);
    if (path.isAbsolute(raw)) {
        const abs = path.resolve(raw);
        const rel = normalizeRelPath(path.relative(assets, abs));
        if (!rel || rel.startsWith("..")) {
            throw new Error(`目录不在 assets 下: ${raw}`);
        }
        return { abs, rel };
    }

    const rel = normalizeRelPath(raw);
    return { abs: path.join(assets, rel), rel };
}

function listPsdFiles() {
    fs.ensureDirSync(PSD_DIR);
    return fs.readdirSync(PSD_DIR)
        .filter((name) => /\.(psd|psb)$/i.test(name))
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
        .map((name) => ({
            name,
            relPath: `psd/${name}`,
            absPath: path.join(PSD_DIR, name)
        }));
}

function saveUploadedPsd(filename, buffer) {
    const safeName = path.basename(String(filename || "").trim());
    if (!/\.(psd|psb)$/i.test(safeName)) {
        throw new Error("仅支持 .psd / .psb 文件");
    }
    fs.ensureDirSync(PSD_DIR);
    const dest = path.join(PSD_DIR, safeName);
    if (fs.existsSync(dest)) {
        fs.removeSync(dest);
    }
    fs.writeFileSync(dest, buffer);
    return {
        name: safeName,
        relPath: `psd/${safeName}`,
        absPath: dest
    };
}

function resolvePsdPath(psdPath) {
    const raw = String(psdPath || "").trim();
    if (!raw) return "";
    if (path.isAbsolute(raw) && fs.existsSync(raw)) return path.resolve(raw);
    const rel = path.join(ROOT, raw);
    if (fs.existsSync(rel)) return path.resolve(rel);
    const inPsdDir = path.join(PSD_DIR, raw);
    if (fs.existsSync(inPsdDir)) return path.resolve(inPsdDir);
    const base = path.basename(raw);
    const inPsdDirBase = path.join(PSD_DIR, base);
    if (fs.existsSync(inPsdDirBase)) return path.resolve(inPsdDirBase);
    return path.resolve(raw);
}

function deriveAssetsRoot(prefabDir) {
    const resolved = path.resolve(String(prefabDir || "").trim());
    const parts = resolved.split(path.sep);
    const idx = parts.findIndex((p) => p.toLowerCase() === "assets");
    if (idx >= 0) return parts.slice(0, idx + 1).join(path.sep);
    return path.dirname(resolved);
}

function buildOutPath(prefabDir, prefabName) {
    const dir = path.resolve(String(prefabDir || "").trim());
    const name = String(prefabName || "").trim().replace(/\.prefab$/i, "");
    return path.join(dir, `${name}.prefab`);
}

function runPsd2Desc(psdFile) {
    let output;
    try {
        output = execFileSync(process.execPath, [path.join(ROOT, "psd2desc.js"), psdFile], {
            cwd: ROOT,
            encoding: "utf8",
            maxBuffer: 20 * 1024 * 1024
        });
    } catch (err) {
        const detail = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n").trim();
        throw new Error(detail || "PSD 解析失败");
    }
    const match = output.match(/JSON:\s*(.+?)(?:\r?\n|$)/);
    if (!match) {
        throw new Error("PSD 解析未返回 ui_desc.json 路径");
    }
    const uiDescPath = match[1].trim();
    if (!fs.existsSync(uiDescPath)) {
        throw new Error(`PSD 解析后找不到文件: ${uiDescPath}`);
    }
    return {
        uiDescPath,
        exportDir: path.dirname(uiDescPath)
    };
}

function copyTextures(exportDir, destDir) {
    fs.ensureDirSync(destDir);
    const copied = [];
    for (const name of fs.readdirSync(exportDir)) {
        if (!/\.png$/i.test(name)) continue;
        fs.copySync(path.join(exportDir, name), path.join(destDir, name), { overwrite: true });
        copied.push(name);
    }
    return { destDir, copied };
}

function rewriteSpriteFramePaths(node, fromPrefix, toPrefix) {
    if (!node || fromPrefix === toPrefix) return;
    const from = normalizeRelPath(fromPrefix);
    const to = normalizeRelPath(toPrefix);
    if (node.spriteFramePath) {
        const normalized = normalizeRelPath(node.spriteFramePath);
        if (normalized === from || normalized.startsWith(from + "/")) {
            node.spriteFramePath = normalized.replace(from, to);
        }
    }
    for (const child of node.children || []) {
        rewriteSpriteFramePaths(child, from, to);
    }
}

function buildFontMapForAssets(fontMapPath, assetsRoot, fontsRelPath) {
    if (!fs.existsSync(fontMapPath)) return fontMapPath;

    const fontsPrefix = normalizeRelPath(fontsRelPath);
    const raw = fs.readJsonSync(fontMapPath);
    const adjusted = {};
    let changed = false;

    for (const [family, relPath] of Object.entries(raw)) {
        const normalized = normalizeRelPath(relPath);
        const fileName = path.posix.basename(normalized);
        const nextPath = `${fontsPrefix}/${fileName}`;
        adjusted[family] = nextPath;
        if (nextPath !== normalized) changed = true;
    }

    if (!changed) return fontMapPath;

    const tmpPath = path.join(assetsRoot, ".psd2desc-font-map.json");
    fs.writeJsonSync(tmpPath, adjusted, { spaces: 2 });
    return tmpPath;
}

async function handleExport(body) {
    const psdPath = String(body.psdPath || "").trim();
    const prefabDir = String(body.prefabDir || "").trim();
    const prefabName = String(body.prefabName || "").trim();
    const cc = String(body.cc || "").trim();
    const textureInput = String(body.texturePath || DEFAULT_TEXTURE_SUB_PATH).trim();
    const fontsInput = String(body.fontsPath || "fonts").trim();
    const strict = body.allowMissing !== true;

    if (!psdPath || !prefabDir || !prefabName || !cc || !textureInput || !fontsInput) {
        return {
            ok: false,
            error: "请填写 PSD 文件、预制体保存目录、预制体名称、Cocos 版本、纹理目录和字体目录"
        };
    }

    const psdFile = resolvePsdPath(psdPath);
    if (!fs.existsSync(psdFile)) {
        return { ok: false, error: `找不到 PSD/PSB 文件: ${psdPath}` };
    }

    const assetsRoot = deriveAssetsRoot(prefabDir);
    if (!fs.existsSync(assetsRoot)) {
        return { ok: false, error: `无法定位 Cocos assets 目录，请检查预制体保存路径: ${prefabDir}` };
    }

    let textureDir;
    let fontsDir;
    try {
        textureDir = resolveAssetDir(textureInput, assetsRoot);
        fontsDir = resolveAssetDir(fontsInput, assetsRoot);
    } catch (err) {
        return { ok: false, error: err.message };
    }

    const outPath = buildOutPath(prefabDir, prefabName);
    fs.ensureDirSync(path.dirname(outPath));

    let uiDescPath;
    let exportDir;
    try {
        ({ uiDescPath, exportDir } = runPsd2Desc(psdFile));
    } catch (err) {
        return { ok: false, error: `PSD 解析失败: ${err.message}` };
    }

    const textureCopy = copyTextures(exportDir, textureDir.abs);

    let inPath = uiDescPath;
    if (textureDir.rel !== DEFAULT_TEXTURE_SUB_PATH) {
        const desc = fs.readJsonSync(uiDescPath);
        rewriteSpriteFramePaths(desc, DEFAULT_TEXTURE_SUB_PATH, textureDir.rel);
        const adjustedPath = path.join(exportDir, "ui_desc.prefab-ui.json");
        fs.writeJsonSync(adjustedPath, desc, { spaces: 2 });
        inPath = adjustedPath;
    }

    const fontMap = buildFontMapForAssets(DEFAULT_FONT_MAP, assetsRoot, fontsDir.rel);

    const result = convertToPrefab({
        inPath,
        outPath,
        cc,
        assets: assetsRoot,
        fontMap,
        strict
    });

    return {
        ...result,
        uiDescPath,
        exportDir,
        textureDir: textureCopy.destDir,
        textureCount: textureCopy.copied.length,
        assetsRoot,
        fontsPath: fontsDir.abs
    };
}

async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        });
        res.end();
        return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const htmlPath = path.join(PUBLIC_DIR, "prefab-export.html");
        if (!fs.existsSync(htmlPath)) {
            sendText(res, 404, "prefab-export.html not found");
            return;
        }
        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store"
        });
        res.end(fs.readFileSync(htmlPath, "utf8"));
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/psds") {
        sendJson(res, 200, { ok: true, psds: listPsdFiles() });
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/upload-psd") {
        try {
            const filename = req.headers["x-filename"] || req.headers["x-filename".toLowerCase()];
            if (!filename) {
                sendJson(res, 400, { ok: false, error: "缺少 X-Filename 请求头" });
                return;
            }
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const saved = saveUploadedPsd(filename, Buffer.concat(chunks));
            sendJson(res, 200, { ok: true, ...saved });
        } catch (err) {
            sendJson(res, 400, { ok: false, error: err.message });
        }
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/export") {
        try {
            const body = await readJsonBody(req);
            const result = await handleExport(body);
            sendJson(res, result.ok ? 200 : 400, result);
        } catch (err) {
            sendJson(res, 500, { ok: false, error: err.message });
        }
        return;
    }

    sendText(res, 404, "Not Found");
}

function main() {
    const server = http.createServer((req, res) => {
        handleRequest(req, res).catch((err) => {
            sendJson(res, 500, { ok: false, error: err.message });
        });
    });

    server.listen(PORT, "127.0.0.1", () => {
        console.log(`Prefab 导出页面: http://127.0.0.1:${PORT}/`);
        console.log("按 Ctrl+C 停止服务");
    });
}

if (require.main === module) {
    main();
}

module.exports = {
    resolvePsdPath,
    deriveAssetsRoot,
    resolveAssetDir,
    buildOutPath,
    listPsdFiles,
    saveUploadedPsd,
    handleExport
};
