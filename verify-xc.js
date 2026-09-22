// 最终校验：编码/结构/随机抽样
const fs = require('fs');
const SRC = 'test-data/XC_20250917_053001.CIME';
const OUT = 'test-data/XC_20250917_053001_desensitized.CIME';

const src = fs.readFileSync(SRC);
const orig = new TextDecoder('gb18030').decode(src).replace(/^\uFEFF/, '');
const outBuf = fs.readFileSync(OUT);
// 校验 UTF-8 可解码（无 BOM）
const isUtf8 = !outBuf.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF]));
const out = new TextDecoder('utf8', { fatal: true }).decode(outBuf);
console.log('输出 UTF-8 无 BOM:', isUtf8);
console.log('行数:', orig.split(/\r?\n/).length, '→', out.split(/\r?\n/).length);
console.log('行尾统一 CRLF:', out.includes('\r\n') && !out.replace(/\r\n/g, '').includes('\n'));

// 抽查原始敏感词是否残留
const sampleWords = ['西昌', '四川', '成都', '凉山', '杨房沟', '美姑河', '越西', '会东', '冕山', '永郎', '雷波', '会理', '樟木', '爱民', '尔足', '杜家湾', '盐源', '卡拉', '周家堡', '相岭', '争西', '钢钒', '冕宁', '甘洛', '德昌', '宁南', '木里', '锦屏', '安宁电冶', '安宁电冶', '西昌电力', '巨龙站', '北山站', '清水沟厂', '大坪子', '四合站', '德吉', '龙杠子'];
let hits = 0;
for (const w of sampleWords) {
    if (out.includes(w)) { hits += 1; console.log('残留:', w); }
}
console.log('抽样敏感词残留数:', hits);

// 随机抽查 8 行替换质量
const outLines = out.split(/\r?\n/);
const origLines = orig.split(/\r?\n/);
const idxs = [756, 758, 1031, 16028, 39612, 39613, 100, 5000, 20000, 40000];
for (const i of idxs) {
    const o = origLines[i - 1];
    const n = outLines[i - 1];
    if (o && o.split('\t').length === n.split('\t').length) {
        console.log(`\n行${i}:`);
        console.log(' 原:', JSON.stringify(o.slice(0, 100)));
        console.log(' 新:', JSON.stringify(n.slice(0, 100)));
    }
}
