"use strict";

const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
const { sanitizePrefabArray, readFileIdMap } = require("./prefab-sanitize");

const META_VER = {
    2: "1.2.7",
    3: "1.1.50"
};

function readExistingUuid(metaPath) {
    if (!fs.existsSync(metaPath)) return "";
    try {
        const meta = fs.readJsonSync(metaPath);
        return typeof meta.uuid === "string" ? meta.uuid : "";
    } catch (_) {
        return "";
    }
}

function writePrefab(prefabArray, outPath, ccVersion) {
    const cleaned = sanitizePrefabArray(prefabArray);
    fs.ensureDirSync(path.dirname(outPath));
    fs.writeJsonSync(outPath, cleaned, { spaces: 2 });

    const metaPath = outPath + ".meta";
    const uuid = readExistingUuid(metaPath) || crypto.randomUUID();
    const meta = {
        ver: META_VER[ccVersion] || META_VER[3],
        uuid,
        importer: "prefab",
        optimizationPolicy: "AUTO",
        asyncLoadAssets: false,
        readonly: false,
        subMetas: {}
    };
    if (ccVersion === 3) {
        delete meta.asyncLoadAssets;
        delete meta.readonly;
        meta.subMetas = {};
    }
    fs.writeJsonSync(metaPath, meta, { spaces: 2 });
    return { prefabPath: outPath, metaPath, uuid, nodeCount: cleaned.length };
}

module.exports = { writePrefab, readFileIdMap, META_VER };
