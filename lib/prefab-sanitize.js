"use strict";

const crypto = require("crypto");

const CUSTOM_LABEL_FIELDS = ["_psdTextData", "_psdTextDataVersion"];

function isRef(value) {
    return value && typeof value === "object" && typeof value.__id__ === "number";
}

function stripCustomFields(arr) {
    for (const obj of arr) {
        if (!obj || typeof obj !== "object") continue;
        for (const key of CUSTOM_LABEL_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                delete obj[key];
            }
        }
    }
    return arr;
}

function newFileId() {
    return crypto.randomBytes(5).toString("hex").slice(0, 9);
}

function isExternalPrefabAsset(asset) {
    return asset && typeof asset === "object" && typeof asset.__uuid__ === "string";
}

function hadNestedPrefabLink(info) {
    return isExternalPrefabAsset(info.asset) || info.instance != null;
}

function collectNodeIdsInSubtree(arr, startNodeId) {
    const nodes = new Map();
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].__type__ === "cc.Node") nodes.set(i, arr[i]);
    }

    const ids = new Set();
    function walk(nodeId) {
        if (nodeId == null || !nodes.has(nodeId) || ids.has(nodeId)) return;
        ids.add(nodeId);
        const node = nodes.get(nodeId);
        for (const childRef of node._children || []) {
            if (isRef(childRef)) walk(childRef.__id__);
        }
    }
    walk(startNodeId);
    return ids;
}

function findPrefabInfoForNode(arr, nodeId) {
    for (const obj of arr) {
        if (!obj || obj.__type__ !== "cc.PrefabInfo") continue;
        const rootId = obj.root && obj.root.__id__;
        if (rootId === nodeId) return obj;
    }
    return null;
}

function regenerateFileIdsInSubtree(arr, rootNodeId) {
    for (const nodeId of collectNodeIdsInSubtree(arr, rootNodeId)) {
        const info = findPrefabInfoForNode(arr, nodeId);
        if (info) info.fileId = newFileId();
    }
}

function collectExternalPrefabUuids(arr) {
    const uuids = new Set();
    for (const obj of arr) {
        if (!obj || obj.__type__ !== "cc.PrefabInfo") continue;
        if (isExternalPrefabAsset(obj.asset)) uuids.add(obj.asset.__uuid__);
    }
    return uuids;
}

function flattenNestedPrefabLinks(arr) {
    let prefabId = -1;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].__type__ === "cc.Prefab") {
            prefabId = i;
            break;
        }
    }
    if (prefabId < 0) return arr;

    const nestedRootNodeIds = [];

    for (const obj of arr) {
        if (!obj || obj.__type__ !== "cc.PrefabInfo") continue;
        const wasNested = hadNestedPrefabLink(obj);

        obj.instance = null;
        if (obj.targetOverrides != null) obj.targetOverrides = null;
        if (obj.nestedPrefabInstanceRoots != null) obj.nestedPrefabInstanceRoots = null;
        if (obj.sync != null) obj.sync = false;
        if (!obj.asset || obj.asset.__uuid__) {
            obj.asset = { __id__: prefabId };
        }

        if (wasNested) {
            const rootId = obj.root && obj.root.__id__;
            if (rootId != null) nestedRootNodeIds.push(rootId);
        }
    }

    for (const rootNodeId of nestedRootNodeIds) {
        regenerateFileIdsInSubtree(arr, rootNodeId);
    }
    return arr;
}

function collectReachable(arr, startId, seen) {
    if (startId == null || startId < 0 || startId >= arr.length) return;
    if (seen.has(startId)) return;
    seen.add(startId);

    const obj = arr[startId];
    if (!obj || typeof obj !== "object") return;

    for (const value of Object.values(obj)) {
        if (isRef(value)) {
            collectReachable(arr, value.__id__, seen);
        } else if (Array.isArray(value)) {
            for (const item of value) {
                if (isRef(item)) collectReachable(arr, item.__id__, seen);
            }
        } else if (value && typeof value === "object") {
            for (const nested of Object.values(value)) {
                if (isRef(nested)) collectReachable(arr, nested.__id__, seen);
            }
        }
    }
}

function remapRefs(value, idMap) {
    if (isRef(value)) {
        const next = idMap.get(value.__id__);
        return next == null ? value : { __id__: next };
    }
    if (Array.isArray(value)) {
        return value.map((item) => remapRefs(item, idMap));
    }
    if (value && typeof value === "object" && value.__type__) {
        const copy = { ...value };
        for (const key of Object.keys(copy)) {
            copy[key] = remapRefs(copy[key], idMap);
        }
        return copy;
    }
    return value;
}

function pruneUnreferenced(arr) {
    let prefabId = -1;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].__type__ === "cc.Prefab") {
            prefabId = i;
            break;
        }
    }
    if (prefabId < 0) return arr;

    const seen = new Set();
    collectReachable(arr, prefabId, seen);

    const next = [];
    const idMap = new Map();
    for (let i = 0; i < arr.length; i++) {
        const obj = arr[i];
        if (!seen.has(i)) continue;
        if (obj && obj.__type__ === "cc.PrefabInstance") continue;
        idMap.set(i, next.length);
        next.push(remapRefs(arr[i], idMap));
    }
    return next;
}

function buildNodePaths(arr) {
    const nodes = new Map();
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].__type__ === "cc.Node") {
            nodes.set(i, arr[i]);
        }
    }

    const paths = new Map();
    function walk(nodeId, prefix) {
        const node = nodes.get(nodeId);
        if (!node) return;
        const name = node._name || "node";
        const path = prefix ? `${prefix}/${name}` : name;
        paths.set(nodeId, path);
        for (const childRef of node._children || []) {
            if (isRef(childRef)) walk(childRef.__id__, path);
        }
    }

    for (const [nodeId, node] of nodes) {
        if (!node._parent) walk(nodeId, "");
    }
    return paths;
}

function readFileIdMap(prefabPath, fs) {
    if (!prefabPath || !fs.existsSync(prefabPath)) return new Map();

    let arr;
    try {
        arr = fs.readJsonSync(prefabPath);
    } catch (_) {
        return new Map();
    }
    if (!Array.isArray(arr)) return new Map();

    const nodePaths = buildNodePaths(arr);
    const map = new Map();
    for (let i = 0; i < arr.length; i++) {
        const obj = arr[i];
        if (!obj || obj.__type__ !== "cc.PrefabInfo" || !obj.fileId) continue;
        const rootId = obj.root && obj.root.__id__;
        const path = nodePaths.get(rootId);
        if (path) map.set(path, obj.fileId);
    }
    return map;
}

function sanitizePrefabArray(arr) {
    if (!Array.isArray(arr)) return arr;
    stripCustomFields(arr);
    flattenNestedPrefabLinks(arr);
    return pruneUnreferenced(arr);
}

module.exports = {
    sanitizePrefabArray,
    readFileIdMap,
    stripCustomFields,
    flattenNestedPrefabLinks,
    pruneUnreferenced,
    collectExternalPrefabUuids
};
