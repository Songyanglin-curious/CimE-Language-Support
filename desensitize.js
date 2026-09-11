// 临时脚本：脱敏 test-data 下的 CIME 测试数据，跑完删除
// 策略：只替换名称类内容，行数/Tab 分隔/字段结构/引号包裹/数值全部保持原样
const fs = require('fs');

// ---- point_table.cime ----
// 1) 间隔/线路名（含电压等级+中文线路名+编号）→ 模拟间隔名，同间隔统一映射
const segMap = new Map();
let segCounter = 0;
function mapSegment(name) {
    if (!segMap.has(name)) {
        segCounter += 1;
        segMap.set(name, `模拟${segCounter}线`);
    }
    return segMap.get(name);
}
// 行内形如 "110kV赵康线2119测控装置xxx" / "220kV华赵Ⅰ线2126智能组件xxx"
// 替换为 "110kV模拟1线测控装置xxx"：电压等级保留（非敏感），线路名+编号 → 模拟名
function desensitizeName(s) {
    return s.replace(/(\d+kV)\s*([^\t'·]+?\d{3,})(测控装置|智能组件)/gu, (all, kv, seg, suffix) => `${kv}${mapSegment(seg)}${suffix}`);
}

// 2) 装置号：Dxx / DTxx → DEVxx（保持字母+数字结构）
// 3) 设备号：CT21xx / CT21xxD → DEV1x（统一）
// 4) 引用前缀：D65LD0/ 等 → DEV65LD0/，CT2122CTRL/ → DEV1CTRL/（跟随装置映射）
const devMap = new Map();
function mapDev(code) {
    if (!devMap.has(code)) {
        devMap.set(code, `DEV${String(devMap.size + 1).padStart(2, '0')}`);
    }
    return devMap.get(code);
}

const pt = fs.readFileSync('test-data/point_table.cime', 'utf8');
const ptLines = pt.split(/\r?\n/);
const out = ptLines.map((line) => {
    if (!line.includes('\t')) { return desensitizeName(line); }
    const f = line.split('\t');
    for (let i = 0; i < f.length; i += 1) {
        let cell = f[i];
        if (i === 3) {
            // DeviceName 列：D65 / CT2122 / CT2122D
            if (/^(D\d{2}|CT\d{3,}D?)$/.test(cell)) { cell = mapDev(cell); }
        } else if (i === 4) {
            // SignalRef 列：D65LD0/xxx 或 CT2122CTRL/xxx → 映射后的装置前缀
            const m = cell.match(/^([A-Z]+\d{2,})((?:LD0|CTRL|PROT|MEAS)?)\//);
            if (m) { cell = mapDev(m[1]) + m[2] + cell.slice(m[0].length); }
        } else {
            cell = desensitizeName(cell);
        }
        f[i] = cell;
    }
    return f.join('\t');
});
fs.writeFileSync('test-data/point_table.cime', out.join('\r\n'), 'utf8');

// ---- OnLineMonitor.CIME ----
// 装置名 CT2201 → DEV01（DataRef 列同步）；时间戳 → 固定示例时间
const ol = fs.readFileSync('test-data/OnLineMonitor.CIME', 'utf8');
let olOut = ol.replace(/CT2201/g, 'DEV01');
olOut = olOut.replace(/Time='[^']*'/g, "Time='2024-01-01 00:00:00'");
olOut = olOut.replace(/UpdateTime='[^']*'/g, "UpdateTime='2024-01-01 00:00:00'");
fs.writeFileSync('test-data/OnLineMonitor.CIME', olOut, 'utf8');

// ---- 校验：行数、Tab 列数不变 ----
const chk = fs.readFileSync('test-data/point_table.cime', 'utf8').split(/\r?\n/);
console.log('point_table 行数:', ptLines.length, '→', chk.length);
const badCols = chk.filter((l, i) => l.includes('\t') && ptLines[i].split('\t').length !== l.split('\t').length);
console.log('列数不一致行:', badCols.length);
const residual = chk.filter((l) => /赵|华|池|湖|武|苗|东线|D6?5|CT2\d/.test(l));
console.log('残留敏感词行:', residual.length, residual.slice(0, 3));
console.log('映射: 间隔', segMap.size, '个, 装置', devMap.size, '个');
