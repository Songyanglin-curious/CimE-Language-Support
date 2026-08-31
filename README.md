# CimE Language Support

VS Code 的 CIM/E 文件支持扩展，适用于阅读 `.CIME` 和 `.cime` 文件。

![Sticky Scroll 效果](images/sticky-scroll-demo.gif)

## 功能

- 识别 CIM/E 文件并提供语法着色
- 折叠成对标签和数据块
- 使用 Sticky Scroll 固定当前数据块的标签、表头和字段说明
- 支持中文标签、`<类名::实体名>` 和 OnLineMonitor 常见写法
- 兼容 GB/T 30149—2013、GB/T 30149—2019 常见结构

## 使用

安装扩展后直接打开 CIM/E 文件即可。

Sticky Scroll 默认启用。如果编辑器顶部没有显示当前数据块信息，请在设置中开启 `Editor: Sticky Scroll Enabled`，或从命令面板运行 `View: Toggle Sticky Scroll`。

## 说明

当前版本主要用于阅读 CIM/E 文件，暂不提供语义校验、自动补全、格式化和格式转换。

问题和未覆盖的文件写法可以提交到 [GitHub Issues](https://github.com/Songyanglin-curious/CimE-Language-Support/issues)。
