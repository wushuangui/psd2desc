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

    const ccVersion = String(opts.cc);
    if (ccVersion !== "2" && ccVersion !== "3") {
        console.error("❌ --cc 必须是 2 或 3");
        process.exit(1);
    }

    const inPath = path.resolve(opts.inPath);
    const outPath = path.resolve(opts.outPath);
    if (!fs.existsSync(inPath)) {
        console.error(`❌ 找不到输入文件: ${inPath}`);
        process.exit(1);
    }

    const rootDesc = fs.readJsonSync(inPath);
    const { root, warnings } = buildIr(rootDesc);
    const meta = new MetaResolver(opts.assets, path.resolve(opts.fontMap));
    const validation = meta.validateIr(root);

    if (warnings.length) {
        console.warn("⚠️ 转换警告:");
        for (const w of warnings) console.warn(`   ${w}`);
    }
    if (validation.fontWarnings.length) {
        console.warn("⚠️ 字体警告:");
        for (const w of validation.fontWarnings) console.warn(`   ${w}`);
    }
    if (validation.missing.length) {
        console.error("❌ 缺少资源 meta / UUID:");
        for (const m of validation.missing) console.error(`   ${m}`);
        if (opts.strict) {
            process.exit(1);
        }
    }

    const prefabArray = ccVersion === "2"
        ? emitPrefab2x(root, meta)
        : emitPrefab3x(root, meta);

    const result = writePrefab(prefabArray, outPath, Number(ccVersion));
    console.log(`✅ Prefab: ${result.prefabPath}`);
    console.log(`📄 Meta:   ${result.metaPath}`);
    console.log(`🔑 UUID:   ${result.uuid}`);
    console.log(`📦 节点数: ${prefabArray.length}`);
    console.log(`🎯 目标:   Cocos Creator ${ccVersion === "2" ? "2.4.13" : "3.8.8"}`);
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error("❌ 转换失败:", err.message);
        process.exit(1);
    }
}

module.exports = { parseArgs, buildIr };
