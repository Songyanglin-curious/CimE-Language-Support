const vscode = require('vscode');
const { tokenizeFields, findFieldIndex } = require('./cimeFields');

const tagName = '[A-Za-z_\\u3400-\\u9fff][A-Za-z0-9_\\u3400-\\u9fff:.-]*';
const openingTag = new RegExp(`^\\s*<(?!(?:!|/|@|#))(${tagName})(?:\\s[^>]*)?>$`, 'u');
const closingTag = new RegExp(`^\\s*</(${tagName})\\s*>$`, 'u');
const selfClosingTag = /\/\s*>$/u;
const plainHeader = /^\s*@#?(?:\s|$)/u;
const wrappedHeader = /^\s*<@#?>/u;
const fieldComment = /^\s*(?:\/\/|<!--)/u;

// 行首标记：<@#> / <@> / <#> 为 2019 包裹格式，@# / @ / # 为旧格式
const lineMarker = /^\s*(<@#>|<@>|<#>|@#|[@#])(?=\s|$)/u;

/**
 * Pair opening/closing tags and return the matched ranges.
 */
function pairTags(document) {
    const tagStack = [];
    const tagRanges = [];

    for (let line = 0; line < document.lineCount; line += 1) {
        const text = document.lineAt(line).text.trimEnd();
        const close = text.match(closingTag);
        if (close) {
            for (let index = tagStack.length - 1; index >= 0; index -= 1) {
                if (tagStack[index].name !== close[1]) {
                    continue;
                }
                const opening = tagStack[index];
                tagStack.splice(index, 1);
                if (line > opening.start) {
                    tagRanges.push({ start: opening.start, end: line });
                }
                break;
            }
            continue;
        }

        const open = text.match(openingTag);
        if (open && !selfClosingTag.test(text)) {
            // 2013 object blocks may start as <Class::Entity> but close as
            // </Class>. Match the class portion while retaining the full source
            // line as the folding range start.
            const name = open[1].split('::', 1)[0];
            tagStack.push({ name, start: line });
        }
    }

    return tagRanges;
}

/** 是否横表式表头行（@ / <@>） */
function isHorizontalHeader(text) {
    const marker = text.match(lineMarker);
    return Boolean(marker) && (marker[1] === '@' || marker[1] === '<@>');
}

/** 是否数据行（# / <#>） */
function isDataRow(text) {
    const marker = text.match(lineMarker);
    return Boolean(marker) && (marker[1] === '#' || marker[1] === '<#>');
}

/**
 * Collect horizontal data blocks as reusable structures for the crosshair:
 * each block spans from its header line to (excluding) the closing tag line.
 */
function collectDataBlocks(document) {
    const tagRanges = pairTags(document);
    const blocks = [];

    for (let line = 0; line < document.lineCount; line += 1) {
        const text = document.lineAt(line).text.trimEnd();
        if (!isHorizontalHeader(text)) {
            continue; // 纵表式（@# / <@#>）没有列的概念，跳过
        }

        const commentLine = line + 1 < document.lineCount
            && fieldComment.test(document.lineAt(line + 1).text.trimEnd())
            ? line + 1
            : undefined;

        const containing = tagRanges
            .filter(({ start, end }) => start < line && line < end)
            .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
        if (!containing) {
            continue;
        }

        blocks.push({ headerLine: line, commentLine, endLine: containing.end });
    }

    return blocks;
}

/**
 * Pair every tag first, then associate each data header with its nearest
 * enclosing tag. Only that data-block tag and its header/comment ranges are
 * exposed to Sticky Scroll. Header ranges end just before the closing line,
 * so they remain visible while records are scrolled.
 */
function provideCimeFoldingRanges(document) {
    const tagRanges = pairTags(document);

    const ranges = [];
    const dataBlockRanges = new Map();

    for (let line = 0; line < document.lineCount; line += 1) {
        const text = document.lineAt(line).text.trimEnd();
        if (!plainHeader.test(text) && !wrappedHeader.test(text)) {
            continue;
        }

        const commentLine = line + 1 < document.lineCount
            && fieldComment.test(document.lineAt(line + 1).text.trimEnd())
            ? line + 1
            : undefined;

        const containing = tagRanges
            .filter(({ start, end }) => start < line && line < end)
            .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
        if (!containing) {
            continue;
        }

        dataBlockRanges.set(`${containing.start}:${containing.end}`, containing);
        const end = containing.end - 1;
        if (end > line) {
            ranges.push(new vscode.FoldingRange(line, end, vscode.FoldingRangeKind.Region));
        }
        if (commentLine !== undefined && end > commentLine) {
            ranges.push(new vscode.FoldingRange(commentLine, end, vscode.FoldingRangeKind.Region));
        }
    }

    for (const { start, end } of dataBlockRanges.values()) {
        ranges.push(new vscode.FoldingRange(start, end, vscode.FoldingRangeKind.Region));
    }

    const unique = new Map();
    for (const range of ranges) {
        unique.set(`${range.start}:${range.end}`, range);
    }
    return [...unique.values()].sort((left, right) => left.start - right.start || left.end - right.end);
}

// ---- 十字定位 ----

// 装饰配色（半透明，亮/暗主题下均可见）
const CROSSHAIR_ROW_COLOR = 'rgba(66, 133, 244, 0.10)';    // 当前行淡背景
const CROSSHAIR_COLUMN_COLOR = 'rgba(66, 133, 244, 0.18)'; // 可见范围内同列其他行淡背景
const CROSSHAIR_FIELD_COLOR = 'rgba(255, 167, 38, 0.35)';  // 当前字段与表头对应字段背景
const CROSSHAIR_LABEL_COLOR = 'rgba(153, 153, 153, 0.9)';  // 字段名内联标签

let rowDecoration;
let fieldDecoration;
let columnDecoration;
let labelDecoration;
let crosshairStatus = null;
let decoratedEditor = null;
let blockCache = null;

/** 获取数据块列表，按文档版本缓存，避免每次光标移动都全文扫描 */
function getDataBlocks(document) {
    const uri = document.uri.toString();
    if (blockCache && blockCache.uri === uri && blockCache.version === document.version) {
        return blockCache.blocks;
    }
    blockCache = { uri, version: document.version, blocks: collectDataBlocks(document) };
    return blockCache.blocks;
}

function setCrosshair(editor, rows, fields, columns, labels) {
    editor.setDecorations(rowDecoration, rows);
    editor.setDecorations(fieldDecoration, fields);
    editor.setDecorations(columnDecoration, columns);
    editor.setDecorations(labelDecoration, labels);
}

/** 指定行是否在编辑器可视范围内 */
function isLineVisible(editor, line) {
    return editor.visibleRanges.some((range) => range.start.line <= line && line <= range.end.line);
}

/**
 * 取指定列的字段名：表头英文名 +（若有）注释行对应的中文名。
 * 注释行的 // 与 <!-- 前缀、--> 后缀先剥掉再切分。
 */
function headerLabel(document, block, fieldIndex) {
    const headerField = tokenizeFields(document.lineAt(block.headerLine).text)[fieldIndex];
    if (!headerField) {
        return undefined;
    }
    let label = headerField.text;
    if (block.commentLine !== undefined) {
        let comment = document.lineAt(block.commentLine).text
            .replace(/^\s*(?:\/\/|<!--)\s*/u, '')
            .replace(/-->\s*$/u, '');
        const commentField = tokenizeFields(comment)[fieldIndex];
        if (commentField) {
            label += ` · ${commentField.text}`;
        }
    }
    return label;
}

/**
 * 光标落在横表数据块内时：
 * 当前行淡背景、当前字段与表头对应字段明显背景、
 * 可见范围内同列其他数据行淡背景；
 * 表头滚出视口后在当前字段后内联显示字段名，并由状态栏提示列位置。
 * 全程只读，不修改文档。
 */
function updateCrosshair() {
    const editor = vscode.window.activeTextEditor;

    // 切换编辑器时清掉旧编辑器上残留的装饰
    if (decoratedEditor && decoratedEditor !== editor) {
        setCrosshair(decoratedEditor, [], [], [], []);
    }

    const rows = [];
    const fields = [];
    const columns = [];
    const labels = [];
    let statusText = null;

    if (editor && editor.document.languageId === 'cime') {
        const document = editor.document;
        const cursor = editor.selection.active;
        const blocks = getDataBlocks(document);
        // 光标所在数据块：表头行（含）到闭合标签行（不含）
        const block = blocks.find((item) => cursor.line >= item.headerLine && cursor.line < item.endLine);

        if (block) {
            const lineText = document.lineAt(cursor.line).text;
            const onHeader = cursor.line === block.headerLine;

            if (onHeader || isDataRow(lineText)) {
                const rowFields = tokenizeFields(lineText);
                const fieldIndex = findFieldIndex(rowFields, cursor.character);

                if (fieldIndex >= 0) {
                    const headerFields = onHeader
                        ? rowFields
                        : tokenizeFields(document.lineAt(block.headerLine).text);
                    const field = rowFields[fieldIndex];

                    // 当前行淡背景（表头行本身不铺整行背景）
                    if (!onHeader) {
                        rows.push(new vscode.Range(cursor.line, 0, cursor.line, 0));
                    }

                    // 当前字段 + 表头对应字段（光标在表头行上时二者为同一段）
                    fields.push(new vscode.Range(cursor.line, field.start, cursor.line, field.end));
                    if (!onHeader) {
                        const headerField = headerFields[fieldIndex];
                        if (headerField) {
                            fields.push(new vscode.Range(block.headerLine, headerField.start, block.headerLine, headerField.end));
                        }
                    }

                    // 可见范围内同列的其他数据行（不遍历整个文件）
                    for (const visible of editor.visibleRanges) {
                        const from = Math.max(visible.start.line, block.headerLine + 1);
                        const to = Math.min(visible.end.line, block.endLine - 1);
                        for (let line = from; line <= to; line += 1) {
                            if (line === cursor.line) {
                                continue;
                            }
                            const text = document.lineAt(line).text;
                            if (!isDataRow(text)) {
                                continue;
                            }
                            const cell = tokenizeFields(text)[fieldIndex];
                            if (cell) {
                                columns.push(new vscode.Range(line, cell.start, line, cell.end));
                            }
                        }
                    }

                    // 状态栏提示列位置（表头/数据行均生效）
                    const label = headerLabel(document, block, fieldIndex);
                    statusText = `CIME 第 ${fieldIndex + 1}/${headerFields.length} 列` + (label ? `：${label}` : '');

                    // 表头滚出视口时（Sticky 吸顶条不显示扩展装饰），
                    // 在当前字段后内联显示字段名，保证不看表头也知道列含义
                    if (!onHeader && !isLineVisible(editor, block.headerLine) && label) {
                        labels.push({
                            range: new vscode.Range(cursor.line, field.end, cursor.line, field.end),
                            renderOptions: {
                                after: {
                                    contentText: ` ◂ ${label}`,
                                    color: CROSSHAIR_LABEL_COLOR,
                                    fontStyle: 'italic',
                                },
                            },
                        });
                    }
                }
            }
        }
    }

    if (editor) {
        setCrosshair(editor, rows, fields, columns, labels);
    }
    if (crosshairStatus) {
        if (statusText) {
            crosshairStatus.text = statusText;
            crosshairStatus.show();
        } else {
            crosshairStatus.hide();
        }
    }
    decoratedEditor = editor;
}

function activate(context) {
    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider(
            { language: 'cime' },
            { provideFoldingRanges: provideCimeFoldingRanges },
        ),
    );

    // 十字定位：行 / 列 / 字段三层装饰 + 字段名内联标签
    rowDecoration = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: CROSSHAIR_ROW_COLOR,
    });
    fieldDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: CROSSHAIR_FIELD_COLOR,
    });
    columnDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: CROSSHAIR_COLUMN_COLOR,
    });
    // 注意：类型上声明空的 after，DecorationOptions 里的 renderOptions.after 才会生效
    labelDecoration = vscode.window.createTextEditorDecorationType({ after: {} });

    crosshairStatus = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100,
    );

    context.subscriptions.push(
        rowDecoration,
        fieldDecoration,
        columnDecoration,
        labelDecoration,
        crosshairStatus,
        vscode.window.onDidChangeTextEditorSelection(() => updateCrosshair()),
        vscode.window.onDidChangeActiveTextEditor(() => updateCrosshair()),
        vscode.window.onDidChangeTextEditorVisibleRanges(() => updateCrosshair()),
        vscode.workspace.onDidChangeTextDocument(() => updateCrosshair()),
    );

    updateCrosshair();
}

function deactivate() { }

module.exports = { activate, deactivate, provideCimeFoldingRanges };
