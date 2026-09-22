'use strict';

// CIM/E 字段切分器
// 纯函数实现，不依赖 VS Code API，供十字定位及后续 Hover、字段校验复用。

/** 行首数据标记：旧格式 @ / # / @#，2019 包裹格式 <@> / <#> / <@#>
 * 标记后允许紧跟空白、行尾或非空字段名（如 @Num、#1），标记本身不并入字段 */
const PREFIX = /^\s*(?:<@#>|<@>|<#>|@#|[@#])(?=\s|$|\S)/u;
/** 行尾闭合标记：2019 包裹格式 */
const SUFFIX = /(?:<\/@#>|<\/@>|<\/#>)\s*$/u;

/** 空白字符：Space / Tab */
function isSpace(ch) {
  return ch === ' ' || ch === '\t';
}

/**
 * 将一行 CIM/E 文本切分为字段列表。
 * 处理：Space / Tab / 连续空白、'...' 与 "..." 引号字符串（内部允许空白）、
 * 行首 @ / # / @# / <@> / <#> / <@#> 标记、行尾 </@> / </#> / </@#> 闭合标记、
 * 逗号分隔的多值字段。
 * @param {string} line 原始行文本
 * @returns {Array<{text: string, start: number, end: number}>} 字段列表，start/end 为字符偏移，end 为开区间
 */
function tokenizeFields(line) {
  const fields = [];

  // 有效范围：剥掉行尾闭合标记
  let end = line.length;
  const suffix = line.match(SUFFIX);
  if (suffix) {
    end = suffix.index;
  }

  // 跳过行首标记
  let i = 0;
  const prefix = line.slice(0, end).match(PREFIX);
  if (prefix) {
    i = prefix[0].length;
  }

  while (i < end) {
    const ch = line[i];

    // 空白与逗号视为分隔符
    if (isSpace(ch) || ch === ',') {
      i += 1;
      continue;
    }

    const start = i;
    if (ch === "'" || ch === '"') {
      // 引号字符串：整段（含引号）视为一个字段，未闭合时取到行尾
      const quote = ch;
      i += 1;
      while (i < end && line[i] !== quote) {
        i += 1;
      }
      if (i < end) {
        i += 1; // 吞掉闭合引号
      }
    } else {
      while (i < end && !isSpace(line[i]) && line[i] !== ',') {
        i += 1;
      }
    }
    fields.push({ text: line.slice(start, i), start, end: i });
  }

  return fields;
}

/**
 * 找出指定偏移所在字段的下标（偏移落在字段尾部边界时算作该字段）。
 * @param {Array<{start: number, end: number}>} fields tokenizeFields 的结果
 * @param {number} offset 字符偏移
 * @returns {number} 字段下标，不在任何字段上时返回 -1
 */
function findFieldIndex(fields, offset) {
  for (let index = 0; index < fields.length; index += 1) {
    if (offset >= fields[index].start && offset <= fields[index].end) {
      return index;
    }
  }
  return -1;
}

module.exports = { tokenizeFields, findFieldIndex };
