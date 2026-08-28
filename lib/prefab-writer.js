"use strict";

const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");

const META_VER = {
    2: "1.2.7",
    3: "1.1.50"
};

function writePrefab(prefabArray, outPath, ccVersion) {
    fs.ensureDirSync(path.dirname(outPath));
    fs.writeJsonSync(outPath, prefabArray, { spaces: 2 });

    const uuid = crypto.randomUUID();
    const metaPath = outPath + ".meta";
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
    return { prefabPath: outPath, metaPath, uuid };
}

module.exports = { writePrefab, META_VER };
