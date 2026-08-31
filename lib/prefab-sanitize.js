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
    const node = arr[nodeId];
    if (!node || node.__type__ !== "cc.Node" || !isRef(node._prefab)) return null;
    const info = arr[node._prefab.__id__];
    return info && info.__type__ === "cc.PrefabInfo" ? info : null;
}

function getPrefabEntry(arr) {
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].__type__ === "cc.Prefab") {
            return { prefabId: i, rootNodeId: isRef(arr[i].data) ? arr[i].data.__id__ : null };
        }
    }
    return { prefabId: -1, rootNodeId: null };
}

const LABEL_FIELDS_EDITOR_2X = [
    "_useOriginalSize",
    "_horizontalAlign",
    "_verticalAlign",
    "_actualFontSize",
    "_fontFamily",
    "_overflow",
    "_font",
    "_isBold",
    "_isItalic",
    "_isUnderline",
    "_cacheMode"
];

function stripLabelFieldsForEditor2x(arr) {
    for (const obj of arr) {
        if (!obj || obj.__type__ !== "cc.Label") continue;
        for (const key of LABEL_FIELDS_EDITOR_2X) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                delete obj[key];
            }
        }
    }
    return arr;
}

function normalizePrefabInfoAssets(arr, options) {
    const ccVersion = options && options.ccVersion;
    const is3x = ccVersion === 3 || (ccVersion == null && isPrefab3x(arr));
    const { prefabId, rootNodeId } = getPrefabEntry(arr);
    if (prefabId < 0 || rootNodeId == null) return arr;

    const prefabInfoToNode = new Map();
    for (let i = 0; i < arr.length; i++) {
        const node = arr[i];
        if (!node || node.__type__ !== "cc.Node" || !isRef(node._prefab)) continue;
        prefabInfoToNode.set(node._prefab.__id__, i);
    }

    for (let i = 0; i < arr.length; i++) {
        const info = arr[i];
        if (!info || info.__type__ !== "cc.PrefabInfo") continue;

        if (!is3x) {
            if (Object.prototype.hasOwnProperty.call(info, "instance")) delete info.instance;
            if (info.targetOverrides != null) delete info.targetOverrides;
            if (info.nestedPrefabInstanceRoots != null) delete info.nestedPrefabInstanceRoots;
            info.sync = false;
        }
        info.root = { __id__: rootNodeId };

        const nodeId = prefabInfoToNode.get(i);
        if (is3x) {
            // 3.x：所有节点 PrefabInfo.asset 都指向主 Prefab，保留 fileId
            info.asset = { __id__: prefabId };
        } else if (nodeId === rootNodeId) {
            info.asset = { __id__: prefabId };
            info.fileId = "";
        } else if (nodeId != null) {
            info.asset = null;
        }
    }
    return arr;
}

function reorderPrefabArray(arr) {
    const { rootNodeId } = getPrefabEntry(arr);
    const infoIndexToNode = new Map();
    for (let i = 0; i < arr.length; i++) {
        const node = arr[i];
        if (!node || node.__type__ !== "cc.Node" || !isRef(node._prefab)) continue;
        infoIndexToNode.set(node._prefab.__id__, i);
    }

    const childInfos = [];
    let rootInfo = null;
    const rest = [];
    const idMap = new Map();

    for (let i = 0; i < arr.length; i++) {
        const obj = arr[i];
        if (obj && obj.__type__ === "cc.PrefabInfo") {
            const nodeId = infoIndexToNode.get(i);
            if (nodeId === rootNodeId) rootInfo = obj;
            else childInfos.push(obj);
        } else {
            idMap.set(i, rest.length);
            rest.push(obj);
        }
    }

    const prefabInfos = rootInfo ? childInfos.concat([rootInfo]) : childInfos;
    const offset = rest.length;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].__type__ === "cc.PrefabInfo") {
            idMap.set(i, offset + prefabInfos.indexOf(arr[i]));
        }
    }

    const next = rest.concat(prefabInfos);
    return next.map((obj) => remapRefs(obj, idMap));
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

    const prefabInfoToNode = new Map();
    for (let i = 0; i < arr.length; i++) {
        const node = arr[i];
        if (!node || node.__type__ !== "cc.Node" || !isRef(node._prefab)) continue;
        prefabInfoToNode.set(node._prefab.__id__, i);
    }

    const nodePaths = buildNodePaths(arr);
    const map = new Map();
    for (let i = 0; i < arr.length; i++) {
        const obj = arr[i];
        if (!obj || obj.__type__ !== "cc.PrefabInfo" || !obj.fileId) continue;
        const nodeId = prefabInfoToNode.get(i);
        const path = nodeId != null ? nodePaths.get(nodeId) : null;
        if (path) map.set(path, obj.fileId);
    }
    return map;
}

function isPrefab3x(arr) {
    return arr.some((obj) => obj && obj.__type__ === "cc.UITransform");
}

function sanitizePrefabArray(arr, options) {
    if (!Array.isArray(arr)) return arr;
    const ccVersion = options && options.ccVersion;
    const is3x = ccVersion === 3 || (ccVersion == null && isPrefab3x(arr));
    stripCustomFields(arr);
    flattenNestedPrefabLinks(arr);
    normalizePrefabInfoAssets(arr, options);
    if (!is3x) {
        stripLabelFieldsForEditor2x(arr);
    }
    const pruned = pruneUnreferenced(arr);
    if (!is3x) {
        for (const obj of pruned) {
            if (obj && obj.__type__ === "cc.Prefab") obj._name = "";
        }
        return reorderPrefabArray(pruned);
    }
    return pruned;
}

module.exports = {
    sanitizePrefabArray,
    isPrefab3x,
    readFileIdMap,
    stripCustomFields,
    flattenNestedPrefabLinks,
    normalizePrefabInfoAssets,
    stripLabelFieldsForEditor2x,
    reorderPrefabArray,
    pruneUnreferenced,
    collectExternalPrefabUuids
};
