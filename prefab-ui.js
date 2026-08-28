#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const http = require("http");
const path = require("path");
const { convertToPrefab } = require("./desc2cocos");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const EXPORT_ROOT = path.join(ROOT, "psd_export");
const DEFAULT_FONT_MAP = path.join(ROOT, "config", "font-map.json");
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

function listUiDescExports() {
    if (!fs.existsSync(EXPORT_ROOT)) return [];

    const results = [];
    const projects = fs.readdirSync(EXPORT_ROOT, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

    for (const project of projects) {
        const projectDir = path.join(EXPORT_ROOT, project);
        const versions = fs.readdirSync(projectDir, { withFileTypes: true })
            .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
            .map((d) => d.name)
            .sort((a, b) => Number(b) - Number(a));

        for (const version of versions) {
            const descPath = path.join(projectDir, version, "ui_desc.json");
            if (fs.existsSync(descPath)) {
                results.push({
                    label: `${project}/${version}`,
                    inPath: path.relative(ROOT, descPath).split(path.sep).join("/"),
                    absPath: descPath,
                    project,
                    version: Number(version)
                });
            }
        }
    }

    return results.sort((a, b) => {
        if (a.project !== b.project) return a.project.localeCompare(b.project);
        return b.version - a.version;
    });
}

function suggestOutPath(inPath, cc) {
    const normalized = String(inPath || "").replace(/\\/g, "/");
    const match = normalized.match(/psd_export\/([^/]+)\/\d+\/ui_desc\.json$/i);
    const name = match ? match[1] : "output";
    const suffix = cc === "3" ? "3x" : "2x";
    return `assets/prefabs/${name}_${suffix}.prefab`;
}

async function handleExport(body) {
    const inPath = String(body.inPath || "").trim();
    const outPath = String(body.outPath || "").trim();
    const cc = String(body.cc || "").trim();
    const assets = String(body.assets || "").trim();
    const fontMap = String(body.fontMap || DEFAULT_FONT_MAP).trim();
    const strict = body.allowMissing !== true;

    if (!inPath || !outPath || !cc || !assets) {
        return {
            ok: false,
            error: "请填写 ui_desc.json 路径、输出 prefab 路径、Cocos 版本和 assets 目录"
        };
    }

    return convertToPrefab({
        inPath: path.isAbsolute(inPath) ? inPath : path.join(ROOT, inPath),
        outPath,
        cc,
        assets,
        fontMap: path.isAbsolute(fontMap) ? fontMap : path.join(ROOT, fontMap),
        strict
    });
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
        sendText(res, 200, fs.readFileSync(htmlPath, "utf8"), "text/html; charset=utf-8");
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/exports") {
        sendJson(res, 200, {
            ok: true,
            exports: listUiDescExports(),
            defaultFontMap: path.relative(ROOT, DEFAULT_FONT_MAP).split(path.sep).join("/")
        });
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/suggest-out") {
        const inPath = url.searchParams.get("in") || "";
        const cc = url.searchParams.get("cc") || "2";
        sendJson(res, 200, { ok: true, outPath: suggestOutPath(inPath, cc) });
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

module.exports = { listUiDescExports, suggestOutPath, handleExport };
