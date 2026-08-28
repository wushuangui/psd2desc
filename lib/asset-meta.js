"use strict";

const crypto = require("crypto");
const fs = require("fs-extra");
const path = require("path");

function ccMajor(ccVersion) {
    return String(ccVersion) === "2" ? 2 : 3;
}

function readPngSize(filePath) {
    const buf = Buffer.alloc(24);
    const fd = fs.openSync(filePath, "r");
    try {
        fs.readSync(fd, buf, 0, 24, 0);
    } finally {
        fs.closeSync(fd);
    }
    if (buf.toString("ascii", 1, 4) !== "PNG" || buf.toString("ascii", 12, 16) !== "IHDR") {
        throw new Error(`不是有效 PNG: ${filePath}`);
    }
    return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20)
    };
}

function buildImageMeta3x(uuid, baseName, width, height) {
    const hw = width / 2;
    const hh = height / 2;
    return {
        ver: "1.0.27",
        importer: "image",
        imported: true,
        uuid,
        files: [".json", ".png"],
        subMetas: {
            "6c48a": {
                importer: "texture",
                uuid: `${uuid}@6c48a`,
                displayName: baseName,
                id: "6c48a",
                name: "texture",
                userData: {
                    wrapModeS: "clamp-to-edge",
                    wrapModeT: "clamp-to-edge",
                    imageUuidOrDatabaseUri: uuid,
                    isUuid: true,
                    visible: false,
                    minfilter: "linear",
                    magfilter: "linear",
                    mipfilter: "none",
                    anisotropy: 0
                },
                ver: "1.0.22",
                imported: true,
                files: [".json"],
                subMetas: {}
            },
            f9941: {
                importer: "sprite-frame",
                uuid: `${uuid}@f9941`,
                displayName: baseName,
                id: "f9941",
                name: "spriteFrame",
                userData: {
                    trimThreshold: 1,
                    rotated: false,
                    offsetX: 0,
                    offsetY: 0,
                    trimX: 0,
                    trimY: 0,
                    width,
                    height,
                    rawWidth: width,
                    rawHeight: height,
                    borderTop: 0,
                    borderBottom: 0,
                    borderLeft: 0,
                    borderRight: 0,
                    packable: true,
                    pixelsToUnit: 100,
                    pivotX: 0.5,
                    pivotY: 0.5,
                    meshType: 0,
                    vertices: {
                        rawPosition: [-hw, -hh, 0, hw, -hh, 0, -hw, hh, 0, hw, hh, 0],
                        indexes: [0, 1, 2, 2, 1, 3],
                        uv: [0, height, width, height, 0, 0, width, 0],
                        nuv: [0, 0, 1, 0, 0, 1, 1, 1],
                        minPos: [-hw, -hh, 0],
                        maxPos: [hw, hh, 0]
                    },
                    isUuid: true,
                    imageUuidOrDatabaseUri: `${uuid}@6c48a`,
                    atlasUuid: "",
                    trimType: "auto"
                },
                ver: "1.0.12",
                imported: true,
                files: [".json"],
                subMetas: {}
            }
        },
        userData: {
            type: "sprite-frame",
            fixAlphaTransparencyArtifacts: false,
            hasAlpha: true,
            redirect: `${uuid}@6c48a`
        }
    };
}

function buildImageMeta2x(uuid, baseName, width, height) {
    return {
        ver: "2.3.7",
        uuid,
        importer: "raw-texture",
        imported: true,
        type: "raw-texture",
        wrapMode: "clamp",
        filterMode: "bilinear",
        premultiplyAlpha: false,
        genMipmaps: false,
        packable: true,
        width,
        height,
        platformSettings: {},
        subMetas: {
            [baseName]: {
                ver: "1.0.4",
                uuid: crypto.randomUUID(),
                importer: "sprite-frame",
                rawTextureUuid: uuid,
                trimType: "auto",
                trimThreshold: 1,
                rotated: false,
                offsetX: 0,
                offsetY: 0,
                trimX: 0,
                trimY: 0,
                width,
                height,
                rawWidth: width,
                rawHeight: height,
                borderTop: 0,
                borderBottom: 0,
                borderLeft: 0,
                borderRight: 0
            }
        }
    };
}

function buildTtfMeta3x(uuid) {
    return {
        ver: "1.0.1",
        importer: "ttf-font",
        imported: true,
        uuid,
        files: [".json"],
        subMetas: {},
        userData: {}
    };
}

function buildTtfMeta2x(uuid) {
    return {
        ver: "1.0.0",
        uuid,
        importer: "ttf-font",
        type: "ttf-font",
        subMetas: {}
    };
}

function writeMetaIfMissing(absPath, builder) {
    const metaPath = absPath + ".meta";
    if (fs.existsSync(metaPath)) return { metaPath, created: false };
    fs.writeJsonSync(metaPath, builder(), { spaces: 2 });
    return { metaPath, created: true };
}

function ensureImageMeta(pngAbsPath, ccVersion) {
    const abs = path.resolve(pngAbsPath);
    if (!fs.existsSync(abs)) return { created: false };
    return writeMetaIfMissing(abs, () => {
        const { width, height } = readPngSize(abs);
        const uuid = crypto.randomUUID();
        const baseName = path.basename(abs, path.extname(abs));
        return ccMajor(ccVersion) === 2
            ? buildImageMeta2x(uuid, baseName, width, height)
            : buildImageMeta3x(uuid, baseName, width, height);
    });
}

function ensureTtfMeta(ttfAbsPath, ccVersion) {
    const abs = path.resolve(ttfAbsPath);
    if (!fs.existsSync(abs)) return { created: false };
    return writeMetaIfMissing(abs, () => {
        const uuid = crypto.randomUUID();
        return ccMajor(ccVersion) === 2 ? buildTtfMeta2x(uuid) : buildTtfMeta3x(uuid);
    });
}

function ensureMappedFontMetas(fontMapPath, assetsRoot, ccVersion) {
    if (!fontMapPath || !fs.existsSync(fontMapPath)) return [];
    const map = fs.readJsonSync(fontMapPath);
    const created = [];
    for (const rel of Object.values(map)) {
        const abs = path.join(assetsRoot, String(rel || "").replace(/\\/g, "/"));
        const result = ensureTtfMeta(abs, ccVersion);
        if (result.created) created.push(abs);
    }
    return created;
}

module.exports = {
    readPngSize,
    ensureImageMeta,
    ensureTtfMeta,
    ensureMappedFontMetas
};
