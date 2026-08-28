"use strict";

const crypto = require("crypto");

class PrefabBuilder {
    constructor() {
        this.arr = [];
    }

    add(obj) {
        const id = this.arr.length;
        this.arr.push(obj);
        return id;
    }

    ref(id) {
        return { __id__: id };
    }

    uuidRef(uuid) {
        return { __uuid__: uuid };
    }

    fileId() {
        return crypto.randomBytes(5).toString("hex").slice(0, 9);
    }

    compPrefabInfo() {
        return {
            __type__: "cc.CompPrefabInfo",
            fileId: this.fileId()
        };
    }

    color(r, g, b, a) {
        return { __type__: "cc.Color", r, g, b, a };
    }

    size(width, height) {
        return { __type__: "cc.Size", width, height };
    }

    vec2(x, y) {
        return { __type__: "cc.Vec2", x, y };
    }

    vec3(x, y, z) {
        return { __type__: "cc.Vec3", x, y, z };
    }

    quat(x, y, z, w) {
        return { __type__: "cc.Quat", x, y, z, w };
    }

    trs(x, y) {
        return {
            __type__: "TypedArray",
            ctor: "Float64Array",
            array: [x, y, 0, 0, 0, 0, 1, 1, 1, 1]
        };
    }
}

module.exports = { PrefabBuilder };
