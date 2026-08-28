#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("path");
const { buildIr } = require("./lib/desc-ir");
const { MetaResolver } = require("./lib/meta-resolver");
const { emitPrefab2x } = require("./lib/emit-2x");
const { emitPrefab3x } = require("./lib/emit-3x");
const { writePrefab, readFileIdMap } = require("./lib/prefab-writer");
const { sanitizePrefabArray, collectExternalPrefabUuids } = require("./lib/prefab-sanitize");
const { ensureMappedFontMetas } = require("./lib/asset-meta");

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
        else if (arg === "--clean") opts.cleanPath = argv[++i];
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
  --allow-missing  缺少 SpriteFrame meta 时仍输出 prefab（默认缺少则失败；缺少字体会自动使用系统默认字体）
  --clean          清理已有 .prefab（移除 _psdTextData、嵌套预制引用、孤立对象）

示例:
  node desc2cocos.js --in psd_export/bingoRule/0/ui_desc.json --out D:/Game/assets/prefabs/bingoRule.prefab --cc 2 --assets D:/Game/assets
  node desc2cocos.js --clean D:/Game/assets/prefabs/rule/8/8.prefab
  node desc2cocos.js --in psd_export/bingoRule/0/ui_desc.json --out D:/Game/assets/prefabs/bingoRule.prefab --cc 3 --assets D:/Game/assets
`);
}

function findPrefabPathByUuid(uuid, searchDirs) {
    for (const dir of searchDirs) {
        if (!dir || !fs.existsSync(dir)) continue;
        let entries;
        try {
            entries = fs.readdirSync(dir);
        } catch (_) {
            continue;
        }
        for (const file of entries) {
            if (!file.endsWith(".prefab.meta")) continue;
            const metaPath = path.join(dir, file);
            try {
                const meta = fs.readJsonSync(metaPath);
                if (meta.uuid === uuid) return metaPath.slice(0, -".meta".length);
            } catch (_) {
                // ignore unreadable meta
            }
        }
    }
    return "";
}

function cleanOnePrefab(resolved) {
    const before = fs.readJsonSync(resolved);
    if (!Array.isArray(before)) {
        throw new Error(`prefab 格式无效: ${resolved}`);
    }
    const after = sanitizePrefabArray(before);
    fs.writeJsonSync(resolved, after, { spaces: 2 });
    return {
        prefabPath: resolved,
        beforeCount: before.length,
        afterCount: after.length,
        removed: before.length - after.length
    };
}

function cleanPrefabFile(prefabPath) {
    const resolved = path.resolve(prefabPath);
    if (!fs.existsSync(resolved)) {
        return { ok: false, error: `找不到 prefab: ${resolved}` };
    }

    const dir = path.dirname(resolved);
    const searchDirs = [dir, path.dirname(dir), path.dirname(path.dirname(dir))];
    const queue = [];
    const visited = new Set();

    function enqueue(filePath) {
        const abs = path.resolve(filePath);
        if (visited.has(abs) || !fs.existsSync(abs)) return;
        visited.add(abs);
        queue.push(abs);
    }

    enqueue(resolved);
    for (const file of fs.readdirSync(dir)) {
        if (file.endsWith(".prefab")) enqueue(path.join(dir, file));
    }

    const cleaned = [];
    while (queue.length) {
        const target = queue.shift();
        let before;
        try {
            before = fs.readJsonSync(target);
        } catch (_) {
            continue;
        }
        if (!Array.isArray(before)) continue;

        for (const uuid of collectExternalPrefabUuids(before)) {
            const refPath = findPrefabPathByUuid(uuid, searchDirs);
            if (refPath) enqueue(refPath);
        }

        cleaned.push(cleanOnePrefab(target));
    }

    const primary = cleaned.find((item) => item.prefabPath === resolved) || cleaned[0];
    return {
        ok: true,
        prefabPath: resolved,
        cleaned,
        beforeCount: primary.beforeCount,
        afterCount: primary.afterCount,
        removed: primary.removed
    };
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
    const fontSetup = ensureMappedFontMetas(fontMapPath, opts.assets, ccVersion);
    const meta = new MetaResolver(opts.assets, fontMapPath);
    const validation = meta.validateIr(root);
    const fontWarnings = [
        ...fontSetup.copiedFromSystem.map(
            (item) => `已从系统字体复制: ${item.rel} <- ${item.source}`
        ),
        ...validation.fontWarnings
    ];

    if (validation.missing.length && strict) {
        return {
            ok: false,
            error: "缺少资源 meta / UUID",
            warnings,
            fontWarnings,
            missing: validation.missing
        };
    }

    const prefabArray = ccVersion === "2"
        ? emitPrefab2x(root, meta, { fileIdMap: readFileIdMap(outPath, fs) })
        : emitPrefab3x(root, meta, { fileIdMap: readFileIdMap(outPath, fs) });

    const result = writePrefab(prefabArray, outPath, Number(ccVersion));
    return {
        ok: true,
        prefabPath: result.prefabPath,
        metaPath: result.metaPath,
        uuid: result.uuid,
        nodeCount: result.nodeCount,
        ccVersion,
        ccLabel: ccVersion === "2" ? "2.4.13" : "3.8.8",
        warnings,
        fontWarnings,
        missing: validation.missing,
        fontSetup
    };
}

function main() {
    const opts = parseArgs(process.argv);
    if (opts.help) {
        printUsage();
        return;
    }

    if (opts.cleanPath) {
        let result;
        try {
            result = cleanPrefabFile(opts.cleanPath);
        } catch (err) {
            console.error("❌ 清理失败:", err.message);
            process.exit(1);
        }
        if (!result.ok) {
            console.error(`❌ ${result.error}`);
            process.exit(1);
        }
        console.log(`✅ 已清理: ${result.prefabPath}`);
        if (result.cleaned && result.cleaned.length > 1) {
            console.log(`📦 同目录/关联 prefab 共 ${result.cleaned.length} 个:`);
            for (const item of result.cleaned) {
                console.log(`   ${item.prefabPath} (${item.beforeCount} → ${item.afterCount})`);
            }
        } else {
            console.log(`📦 对象数: ${result.beforeCount} → ${result.afterCount}（移除 ${result.removed}）`);
        }
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

module.exports = { parseArgs, buildIr, convertToPrefab, cleanPrefabFile };
