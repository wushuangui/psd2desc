#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("path");
const { buildIr } = require("./lib/desc-ir");
const { MetaResolver } = require("./lib/meta-resolver");
const { emitPrefab2x } = require("./lib/emit-2x");
const { emitPrefab3x } = require("./lib/emit-3x");
const { writePrefab } = require("./lib/prefab-writer");

function parseArgs(argv) {
    const opts = {
        inPath: "",
        outPath: "",
        cc: "",
        assets: "",
        fontMap: path.join(__dirname, "config", "font-map.json"),
        strict: true
    };

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--in") opts.inPath = argv[++i];
        else if (arg === "--out") opts.outPath = argv[++i];
        else if (arg === "--cc") opts.cc = argv[++i];
        else if (arg === "--assets") opts.assets = argv[++i];
        else if (arg === "--font-map") opts.fontMap = argv[++i];
        else if (arg === "--allow-missing") opts.strict = false;
        else if (arg === "--help" || arg === "-h") opts.help = true;
    }
    return opts;
}

function printUsage() {
    console.log(`用法: node desc2cocos.js --in <ui_desc.json> --out <out.prefab> --cc <2|3> --assets <cocos/assets>

选项:
  --in           ui_desc.json 路径（必填）
  --out          输出 .prefab 路径（必填）
  --cc           Cocos 版本：2（2.4.13）或 3（3.8.8）（必填）
  --assets       Cocos 工程 assets 根目录（必填）
  --font-map     字体映射 JSON，默认 config/font-map.json
  --allow-missing  缺少 SpriteFrame meta 时仍输出 prefab（默认缺少则失败）

示例:
  node desc2cocos.js --in psd_export/bingoRule/0/ui_desc.json --out D:/Game/assets/prefabs/bingoRule.prefab --cc 2 --assets D:/Game/assets
  node desc2cocos.js --in psd_export/bingoRule/0/ui_desc.json --out D:/Game/assets/prefabs/bingoRule.prefab --cc 3 --assets D:/Game/assets
`);
}

function convertToPrefab(opts) {
    const ccVersion = String(opts.cc);
    if (ccVersion !== "2" && ccVersion !== "3") {
        return { ok: false, error: "--cc 必须是 2 或 3" };
    }

    const inPath = path.resolve(opts.inPath);
    const outPath = path.resolve(opts.outPath);
    if (!fs.existsSync(inPath)) {
        return { ok: false, error: `找不到输入文件: ${inPath}` };
    }

    const fontMapPath = path.resolve(opts.fontMap || path.join(__dirname, "config", "font-map.json"));
    const strict = opts.strict !== false;

    const rootDesc = fs.readJsonSync(inPath);
    const { root, warnings } = buildIr(rootDesc);
    const meta = new MetaResolver(opts.assets, fontMapPath);
    const validation = meta.validateIr(root);

    if (validation.missing.length && strict) {
        return {
            ok: false,
            error: "缺少资源 meta / UUID",
            warnings,
            fontWarnings: validation.fontWarnings,
            missing: validation.missing
        };
    }

    const prefabArray = ccVersion === "2"
        ? emitPrefab2x(root, meta)
        : emitPrefab3x(root, meta);

    const result = writePrefab(prefabArray, outPath, Number(ccVersion));
    return {
        ok: true,
        prefabPath: result.prefabPath,
        metaPath: result.metaPath,
        uuid: result.uuid,
        nodeCount: prefabArray.length,
        ccVersion,
        ccLabel: ccVersion === "2" ? "2.4.13" : "3.8.8",
        warnings,
        fontWarnings: validation.fontWarnings,
        missing: validation.missing
    };
}

function main() {
    const opts = parseArgs(process.argv);
    if (opts.help) {
        printUsage();
        return;
    }

    if (!opts.inPath || !opts.outPath || !opts.cc || !opts.assets) {
        printUsage();
        process.exit(1);
    }

    let result;
    try {
        result = convertToPrefab(opts);
    } catch (err) {
        console.error("❌ 转换失败:", err.message);
        process.exit(1);
    }

    if (!result.ok) {
        if (result.warnings && result.warnings.length) {
            console.warn("⚠️ 转换警告:");
            for (const w of result.warnings) console.warn(`   ${w}`);
        }
        if (result.fontWarnings && result.fontWarnings.length) {
            console.warn("⚠️ 字体警告:");
            for (const w of result.fontWarnings) console.warn(`   ${w}`);
        }
        if (result.missing && result.missing.length) {
            console.error("❌ 缺少资源 meta / UUID:");
            for (const m of result.missing) console.error(`   ${m}`);
        }
        console.error(`❌ ${result.error}`);
        process.exit(1);
    }

    if (result.warnings.length) {
        console.warn("⚠️ 转换警告:");
        for (const w of result.warnings) console.warn(`   ${w}`);
    }
    if (result.fontWarnings.length) {
        console.warn("⚠️ 字体警告:");
        for (const w of result.fontWarnings) console.warn(`   ${w}`);
    }
    if (result.missing.length) {
        console.error("❌ 缺少资源 meta / UUID（已允许继续）:");
        for (const m of result.missing) console.error(`   ${m}`);
    }

    console.log(`✅ Prefab: ${result.prefabPath}`);
    console.log(`📄 Meta:   ${result.metaPath}`);
    console.log(`🔑 UUID:   ${result.uuid}`);
    console.log(`📦 节点数: ${result.nodeCount}`);
    console.log(`🎯 目标:   Cocos Creator ${result.ccLabel}`);
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error("❌ 转换失败:", err.message);
        process.exit(1);
    }
}

module.exports = { parseArgs, buildIr, convertToPrefab };
