"use strict";

const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
const { sanitizePrefabArray, readFileIdMap } = require("./prefab-sanitize");

const META_VER = {
    2: "1.3.2",
    3: "1.1.50"
};

function readExistingMeta(metaPath) {
    if (!fs.existsSync(metaPath)) return null;
    try {
        return fs.readJsonSync(metaPath);
    } catch (_) {
        return null;
    }
}

function writePrefab(prefabArray, outPath, ccVersion) {
    const cleaned = sanitizePrefabArray(prefabArray, { ccVersion });
    fs.ensureDirSync(path.dirname(outPath));
    fs.writeJsonSync(outPath, cleaned, { spaces: 2 });

    const metaPath = outPath + ".meta";
    const existing = readExistingMeta(metaPath);
    const uuid = (existing && existing.uuid) || crypto.randomUUID();
    const meta = ccVersion === 3
        ? {
            ver: META_VER[3],
            importer: "prefab",
            imported: existing && existing.imported === true ? true : false,
            uuid,
            files: existing && Array.isArray(existing.files) ? existing.files : [],
            subMetas: existing && existing.subMetas ? existing.subMetas : {},
            userData: existing && existing.userData
                ? { syncNodeName: true, ...existing.userData }
                : { syncNodeName: true }
        }
        : {
            ver: META_VER[2],
            uuid,
            importer: "prefab",
            optimizationPolicy: "AUTO",
            asyncLoadAssets: false,
            readonly: false,
            subMetas: existing && existing.subMetas ? existing.subMetas : {}
        };
    fs.writeJsonSync(metaPath, meta, { spaces: 2 });
    return { prefabPath: outPath, metaPath, uuid, nodeCount: cleaned.length };
}

module.exports = { writePrefab, readFileIdMap, META_VER };
