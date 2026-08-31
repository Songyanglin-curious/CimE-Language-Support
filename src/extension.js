const vscode = require('vscode');

const tagName = '[A-Za-z_\\u3400-\\u9fff][A-Za-z0-9_\\u3400-\\u9fff:.-]*';
const openingTag = new RegExp(`^\\s*<(?!(?:!|/|@|#))(${tagName})(?:\\s[^>]*)?>$`, 'u');
const closingTag = new RegExp(`^\\s*</(${tagName})\\s*>$`, 'u');
const selfClosingTag = /\/\s*>$/u;
const plainHeader = /^\s*@#?(?:\s|$)/u;
const wrappedHeader = /^\s*<@#?>/u;
const fieldComment = /^\s*(?:\/\/|<!--)/u;

/**
 * Pair every tag first, then associate each data header with its nearest
 * enclosing tag. Only that data-block tag and its header/comment ranges are
 * exposed to Sticky Scroll. Header ranges end just before the closing line,
 * so they remain visible while records are scrolled.
 */
function provideCimeFoldingRanges(document) {
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

function activate(context) {
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(
      { language: 'cime' },
      { provideFoldingRanges: provideCimeFoldingRanges },
    ),
  );
}

function deactivate() {}

module.exports = { activate, deactivate, provideCimeFoldingRanges };
