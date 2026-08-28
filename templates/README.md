# Prefab 格式参考（Fixture）

本目录存放 Cocos Creator **2.4.13** 与 **3.8.8** 的最小 prefab JSON，供 `desc2cocos` 输出结构对照。

## 文件说明

| 文件 | 来源 |
|------|------|
| `reference-2x.json` | CC 2.4.13 最小 prefab（根节点 + Sprite + Label） |
| `reference-3x.json` | CC 3.8.8 最小 prefab（根节点 + UITransform + UIOpacity + Sprite + Label） |

## 校验方式

转换完成后，检查 emit 输出是否包含关键 `__type__` 字段：

**2.x 必须出现：** `cc.Prefab`, `cc.Node`, `cc.Sprite`, `cc.Label`, `cc.PrefabInfo`

**3.x 必须出现：** `cc.Prefab`, `cc.Node`, `cc.UITransform`, `cc.UIOpacity`, `cc.Sprite`, `cc.Label`, `cc.PrefabInfo`

运行本地 fixture 测试：

```bash
node test/validate-desc2cocos.js
```

## 更新模板

若在真实 CC 2.4.13 / 3.8.8 编辑器中导出格式有差异，请在对应版本新建最小 prefab 并覆盖 `reference-*.json`。
