// 临时脚本：对 XC_20250917_053001.CIME 脱敏，输出 UTF-8 新文件，跑完可删除
// 策略：只替换名称类内容（厂站名/工程代号/时间戳），行数/Tab 分隔/字段结构/数值(mRID)全部保持原样
const fs = require('fs');

const SRC = 'test-data/XC_20250917_053001.CIME';
const OUT = 'test-data/XC_20250917_053001_desensitized.CIME';

// GB18030 读取原始内容
const buf = fs.readFileSync(SRC);
const text = new TextDecoder('gb18030').decode(buf).replace(/^\uFEFF/, '');
const lines = text.split(/\r?\n/);
// 提取用的预替换文本：与最终行内形态一致（XC→SD、DL476→DL），保证替换能命中
const text2 = text.replace(/\bXC\b/gu, 'SD').replace(/DL476/gu, 'DL');

// ---- 通用词白名单：保留原样（含数字/电压等级前缀）----
const KEEP_RE = /^(?:(?:\d+(?:\.\d+)?|[\d一二三四五六七八九十]+号?)kV\.?)?(?:[\d一二三四五六七八九十]+号?)?(?:主变|母线|母母线|段母线|集电线|站用变|厂用变|接地变|箱变|逆变|炉变|待用线|备用线|待用[一二三\d]+线|备用[一二三\d]+线|厂房线|水电厂|水电站|电站|风电厂|风电场|光伏电站|变电站|开关站|线路|间隔|变压器|所用变|电容器|电抗器|断路器|隔离开关|互感器|避雷器|熔断器|站|厂|变|线)$/u;

// ---- 核心名归一化：去地域前缀、去 站/厂/变/线 后缀 ----
function normCore(s) {
    return s.replace(/^(?:四川|西昌|成都)[.·]/u, '').replace(/(?:站|厂|变|线)$/u, '');
}

// ---- 映射：归一化核心名 → 模拟N，同名保持一致 ----
const coreMap = new Map();
let counter = 0;
function mapCore(core) {
    if (coreMap.has(core)) return coreMap.get(core);
    counter += 1;
    const name = `模拟${counter}`;
    coreMap.set(core, name);
    return name;
}

// ---- 提取全部候选名称串（长串优先替换，避免嵌套误伤）----
// 条目：whole 完整串 → { norm 归一化核心名, suffix 站/厂/变/线/转发 后缀, tail 电压后缀(-10kV 等), keep }
const seen = new Map();
function collect(whole, core, tail = '') {
    if (seen.has(whole)) return;
    const keep = KEEP_RE.test(whole);
    const suffix = (core.match(/(?:站|厂|变|线|转发)$/u) || [''])[0];
    seen.set(whole, { norm: normCore(core), suffix, tail, keep });
}
// A. 地域前缀开头的名称（含无后缀形态）：四川.杨房沟 / 西昌.集中运监 / 西昌.（甘洛县调）模拟187
//    非贪婪匹配到 分隔符/全角括号/行尾 前，避免吞入后续编号；数字不截断（DL476 等）；
//    站/厂/变/线 不作为终止（让 西昌.大坪子厂盐源 整串提取，与图名列映射一致）；
//    末尾 -10kV/-220kV 等电压后缀剥离（core 不含电压，替换时拼回，保证 模拟N站-10kV 形态）
for (const m of text2.matchAll(/(?:四川|西昌|成都)[.·][\u4e00-\u9fa5A-Za-z0-9ⅠⅡⅢ·.\-（）()]+?(?=$|[\s,;:()（）'"\/\\])/gu)) {
    const w = m[0];
    const v = w.match(/^(.+?)(-\d+(?:\.\d+)?[kK][vV])$/u);
    if (v) collect(v[1] + v[2], v[1], v[2]);
    else collect(w, w);
}
// B. 接线图名中的站名：XC/SD.220kV杨房沟变电站.fac.pic.g（含后缀/无后缀两种），串不带电压前缀
//    站名后允许跟 点/全角括号（如 XC.10kV清水沟厂（甘洛）.fac.pic.g）
for (const m of text2.matchAll(/(?:XC|SD)\.(?:\d+(?:\.\d+)?[kK]V)?([\u4e00-\u9fa5A-Za-z0-9ⅠⅡⅢ·]+?)(变电站|水电站|风电厂|光伏厂|开关站|变|厂|站)(?=[.（）]|$)/gu)) {
    collect(m[1] + m[2], m[1] + m[2]);
}
for (const m of text2.matchAll(/(?:XC|SD)\.(?:\d+(?:\.\d+)?[kK]V)?([\u4e00-\u9fa5A-Za-z0-9ⅠⅡⅢ·]+?)(?=\.fac|\.pic|\.g|$)/gu)) {
    if (m[1] && m[1] !== '') collect(m[1], m[1]);
}
// C. 以 站/厂/变/线/转发 结尾的独立名称：城关站 / 城郊站 / 西昌.鹿厂开关站 / 城郊转发
//    边界允许 备用/待用/主变 等后续（如 马道综自站备用359间隔）；全角括号也算边界
for (const m of text2.matchAll(/([\u4e00-\u9fa5A-Za-z0-9·.ⅠⅡⅢ\-]+?)(站|厂|变|线|转发)(?=$|[\s,;:()（）'"\/\\]|\d|\.fac|\.pic|\.g|备用|待用|主变|母)/gu)) {
    const whole = m[1] + m[2];
    // 跳过上轮模拟名产物
    if (/^模拟\d+/.test(whole)) continue;
    // 跳过吞入电压前缀的整串（如 SD.10kV大坪子厂，由 B 组提取无前缀版本），避免长串替换破坏 大坪子厂盐源
    if (/^(?:XC|SD)\.\d+(?:\.\d+)?[kK][vV]/.test(whole)) continue;
    // 吞入数字/kV 前缀的整串（如 35kV春禾线）：正则引擎不会回退到 春 位置重试，
    // 剥离前缀后仍应收集无前缀名称，保证 35kV春禾线361小车开关 中的 春禾线 能被替换；
    // 剥离后若命中白名单（如 1101箱变 → 箱变）则保持原样
    if (/^\d/.test(whole)) {
        const stripped = whole.replace(/^[\d.]+[kK][vV]?/u, '');
        if (stripped && /^[\u4e00-\u9fa5]/.test(stripped)) collect(stripped, stripped);
        continue;
    }
    collect(whole, whole);
}

// 分配映射并生成替换表（长串优先）
const repl = [];
for (const [whole, { norm, suffix, tail, keep }] of seen) {
    if (keep) continue;
    const mapped = mapCore(norm) + suffix + tail;
    repl.push([whole, mapped]);
}
repl.sort((a, b) => b[0].length - a[0].length);
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ---- 转发类前缀映射（保留量测路径）：成都DL476-转发3000西昌/35kV.325开关/遥信值 → 模拟转发1/35kV... ----
const segMap = new Map();
let segCounter = 0;
function mapSegment(name) {
    if (!segMap.has(name)) {
        segCounter += 1;
        segMap.set(name, `模拟转发${segCounter}`);
    }
    return segMap.get(name);
}

// 区域名映射（裸字段 四川/西昌/成都 → 模拟区域名）
const regionMap = new Map([['四川', '区域1'], ['西昌', '区域2'], ['成都', '区域3']]);

// ---- 处理每行 ----
const outLines = lines.map((line) => {
    // 1) 工程代号 XC → SD（标签后缀、Entity、图名前缀）
    line = line.replace(/\bXC\b/gu, 'SD');
    // 2) 时间戳 → 固定示例时间
    line = line.replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/gu, '2024-01-01 00:00:00');
    // 3) 转发类前缀整串映射（保留路径部分）
    line = line.replace(/(成都DL476-转发[\d\u4e00-\u9fa5]+西昌)(?=[/\\\-]|[\s]|$)/gu, (all, prefix) => mapSegment(prefix));
    // 4) 调度系统代号 DL476 → DL（其余已随转发前缀映射）
    line = line.replace(/DL476/gu, 'DL');
    // 5) 县/地名词：括号内（甘洛）、尾部县名 → 模拟县；供电公司名
    line = line.replace(/[（(](?:甘洛|会东|盐源|德昌|冕宁|越西|雷波|会理|喜德|宁南|木里|锦屏)[)）]/gu, '（模拟县）');
    line = line.replace(/德昌电网供电公司/gu, '模拟供电公司');
    // 6) 厂站名整串替换（先替换，避免破坏 西昌.转发西昌电力 等整串命中）
    for (const [whole, mapped] of repl) {
        if (line.includes(whole)) line = line.split(whole).join(mapped);
    }
    // 6.5) 西昌电力公司 → 模拟电力公司（在 repl 之后，处理 repl 未覆盖的残串）
    line = line.replace(/西昌电力公司/gu, '模拟电力公司');
    line = line.replace(/西昌电力(?!公司)/gu, '模拟电力');
    // 6.6) 设备名前缀公司名（安宁电冶152开关 / 木里电力951开关 / 木里施工352开关）
    line = line.replace(/安宁电冶/gu, '模拟电冶');
    line = line.replace(/木里电力/gu, '模拟电力');
    line = line.replace(/木里施工/gu, '模拟施工');
    // 7) 区域名裸字段（四川/西昌/成都）、无点调度名（西昌转发雅安DL）、尾部县名
    if (line.includes('\t')) {
        line = line.split('\t').map((cell) => {
            cell = regionMap.get(cell) || cell;
            if (/^西昌(?:转发|至)[^\t]*/u.test(cell)) cell = mapSegment(cell);
            return cell.replace(/(?:甘洛|会东|盐源|德昌|冕宁|越西|雷波|会理|喜德|宁南|木里|锦屏)(?=[/\\\-]|$)/gu, '模拟县');
        }).join('\t');
    }
    return line;
});

fs.writeFileSync(OUT, outLines.join('\r\n'), 'utf8');

// ---- 校验 ----
console.log('行数:', lines.length, '→', outLines.length);
let badCols = 0;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].split('\t').length !== outLines[i].split('\t').length) { badCols += 1; }
}
console.log('Tab 列数不一致行:', badCols);

const residual = outLines.filter((l) => /西昌|四川|成都|凉山|DL476|(?<!模拟)转发\d|XC\b|杨房沟|美姑河|越西|会东|冕山|永郎|雷波|会理|樟木|爱民|尔足|杜家湾|盐源|卡拉|周家堡|相岭|争西|钢钒|冕宁|甘洛|集中运监|重要断面|全口径|小水电|西昌电力|城北|松新|茶布朗|月城|兴国寺|城关|城郊|城南|马道|锦屏|德昌|伊达|光能|宁远|盐井|会东大桥|淌塘|锌业|新马|嘎日|俄公堡|撒多|水洛|红莫|树堡|呷榴河|北山|洛哈|长裕|安宁|喜德|鲁南风电|拉马风电|鑫垚|拖觉|城东|凉风坳|雅安|宁南|六城|竹寿|老木河|温泉厂|鹿厂|鑫晶源|顺河|铁厂乡|大坪子|红岩厂|清水沟|半站营|转模型/.test(l));
console.log('残留敏感词行:', residual.length);
console.log('\n--- 残留样例前 20 ---');
for (const l of residual.slice(0, 20)) console.log(JSON.stringify(l.slice(0, 150)));

console.log('\n厂站映射数:', coreMap.size, ' 转发映射数:', segMap.size);
console.log('--- 转发映射 ---');
for (const [n, m] of segMap) console.log(n, '→', m);
let i = 0;
console.log('\n--- 厂站映射抽查（前 40）---');
for (const [core, name] of coreMap) {
    if (i >= 40) break;
    console.log(core, '→', name);
    i += 1;
}
