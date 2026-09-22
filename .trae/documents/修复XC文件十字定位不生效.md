# 修复 XC 文件十字定位不生效

## 摘要

`test-data/XC_20250917_053001.CIME`（GBK 编码，44951 行）十字定位完全不生效，根因有两处语法差异，另有文件截断问题。本计划以最小改动修复两处根因，并顺带满足用户的两条调整要求：

1. `@` / `#` 行首标记后允许紧跟非空字段名（如 `@Num`、`#1`），但**字段分割仍严格以空白/逗号为准**，不收回。
2. 没有闭合标签的节点整块忽略，不影响文件其余正常节点。

## 当前状态分析

### 根因一：表头行 `@Num` 不被识别为横表式表头

[extension.js L13 lineMarker](file:///d:/mycode/CimE-Language-Support/src/extension.js#L13) 与 [cimeFields.js L7 PREFIX](file:///d:/mycode/CimE-Language-Support/src/cimeFields.js#L7) 均要求 `@`/`#` 标记后紧跟空白或行尾（`(?=\s|$)`）：

- 本文件：`@Num\tmRID\t...`、`#\t1\t...` 中 `#` 后是 Tab（可匹配），但 `@` 后是 `N`（不匹配）。
- 实测：44919 个 `#` 行全部匹配，8 个 `@` 表头行全部不匹配 → 横表式表头判定失败，数据块无法建立。

连带影响：`tokenizeFields` 对 `@Num...` 因 PREFIX 不匹配，把 `@Num` 整体当作第 0 个字段，与数据行（`#` 后从 `1` 开始）错列 1。

### 根因二：闭合标签写全名 `</类名::实体名>`，标签配对 0 成功

[pairTags](file:///d:/mycode/CimE-Language-Support/src/extension.js#L18-L51) 压栈时用 `open[1].split('::', 1)[0]` 只保留类名 `ControlArea`，而闭合标签 `</ControlArea::XC>` 匹配出的完整名 `ControlArea::XC` 与栈中名字比较永不相等。

实测：8 个开始标签、7 个闭合标签，配对成功 0 对 → `tagRanges` 为空 → [collectDataBlocks](file:///d:/mycode/CimE-Language-Support/src/extension.js#L69-L95) 丢弃所有表头 → 十字定位完全不触发。

对比：GB/T 2013 标准样例闭合写 `</ClassnameA>`（仅类名），与现有 strip 逻辑配套；本文件是真实工程方言，闭合写全名。

### 次要问题：文件末尾不完整

`<GroundDisconnector::XC>`（L40995）到文件尾（L44951）无闭合标签，文件在数据行处截断（8 开 7 闭）。

## 变更方案

### 1. 放宽行首标记识别（需求一）

**文件：[src/cimeFields.js](file:///d:/mycode/CimE-Language-Support/src/cimeFields.js#L7)**

将 PREFIX 前瞻 `(?=\s|$)` 放宽为 `(?=\s|$|\S)`（等价于"后跟空白、行尾或任意非空白字段名"）：

```js
const PREFIX = /^\s*(?:<@#>|<@>|<#>|@#|[@#])(?=\s|$|\S)/u;
```

**文件：[src/extension.js L13](file:///d:/mycode/CimE-Language-Support/src/extension.js#L13)**

同步放宽 lineMarker：

```js
const lineMarker = /^\s*(<@#>|<@>|<#>|@#|[@#])(?=\s|$|\S)/u;
```

语义与边界（决策项）：
- 标记仍只是行首标记，**不并入字段**：`@Num` → `@` 被跳过，`Num` 是第 0 个字段；`#1` → `1` 是第 0 个字段。表头与数据行列对齐自然恢复。
- **字段分割规则完全不变**（空白/Tab/逗号），tokenizeFields 内部切分逻辑零改动。
- 纵表式 `@#` 分支在 alternation 中排在 `[@#]` 之前，`@#`/`<@#>` 纵表判定不受影响。
- 包裹格式 `<@#>`/`<@>`/`<#>` 同步放宽（统一正则，改动最小，实际 `<@>Num` 写法不存在，无副作用）。
- 已知可接受边界：`@` 单独成行（空表头）原 `$` 分支已允许，行为不变。

### 2. 闭合标签比较前同样剥离 `::` 实体名（需求二）

**文件：[src/extension.js pairTags](file:///d:/mycode/CimE-Language-Support/src/extension.js#L24-L36)**

闭合标签匹配后，比较前对 `close[1]` 做与开始标签相同的 `split('::', 1)[0]`：

```js
const closeName = close[1].split('::', 1)[0];
for (let index = tagStack.length - 1; index >= 0; index -= 1) {
    if (tagStack[index].name !== closeName) {
        continue;
    }
    // ...（配对逻辑不变）
}
```

效果：
- `</ControlArea::XC>` → `ControlArea`，与栈中 `ControlArea` 配对成功 → XC 文件前 7 个节点恢复。
- 未闭合节点 `<GroundDisconnector::XC>` 留在栈中，**不产生 tagRange → 该节点整块忽略**，其余 7 个正常节点不受影响（现有逻辑天然支持，无需额外代码）。
- 向后兼容：`</ClassnameA>`、`</装置参数>`、`</E>` 等不含 `::` 的闭合标签 split 后不变。

### 顺带恢复

`provideCimeFoldingRanges` 与十字定位共用 `pairTags`，上述修复同时恢复该文件的折叠功能（同一根因的自然结果，无额外改动）。

## 假设与决策

- 用户要求"略微放宽，但也只是放宽"：仅放宽**行标记识别**，不新增任何字段切分规则、不改注释行判定（`//`、`<!--` 已支持无空格写法）。
- "未闭合节点忽略"：由 pairTags 现有"只输出配对成功的区间"语义天然满足，不引入容错/警告机制。
- 不做脱敏、不修改数据文件本身；GBK 编码不影响 ASCII 逻辑。
- 不新增测试框架，验证用 node 脚本 + 开发宿主手动验证。

## 验证步骤

1. **脚本验证**（node，读 latin1）：对 XC 文件跑修复后的 `pairTags`/`collectDataBlocks`，断言：
   - 配对成功 7 对，`GroundDisconnector` 未闭合被忽略；
   - 数据块数量 = 7（前 7 个节点各 1 块）；
   - `@Num` 表头 tokenize 后第 0 字段为 `Num`（不含 `@`），与数据行列对齐。
2. **回归验证**：对 `GBT30149-2013-horizontal.CIME`、`GBT30149-2019-horizontal.CIME`、`OnLineMonitor.CIME`、`point_table.cime` 跑同样脚本，断言块数量与修复前一致、无回归。
3. **开发宿主 F5**：打开 XC 文件，光标在数据行/表头行上验证行高亮、列高亮、表头/注释行橙底、吸顶条加粗下划线、状态栏列提示均生效；滚动到 GroundDisconnector 区域确认无高亮（节点被忽略）；再打开 OnLineMonitor.CIME 确认原有功能不回归。
