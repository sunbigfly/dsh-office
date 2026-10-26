<p align="center"><img src="assets/icon.svg?v=initial-010-dsh" width="88" alt="DSH Office"></p>
<h1 align="center">DSH Office</h1>
<p align="center">Word · Excel · PowerPoint，在工作区里完成。</p>
<p align="center">
  <a href="https://github.com/sunbigfly/dsh-office/releases/latest">下载</a> ·
  <a href="docs/usage.md">使用指南</a> ·
  <a href="https://github.com/sunbigfly/dsh-office/issues">反馈</a>
</p>

为 DSH 提供独立的 Office 文档能力。在会话右侧打开文档，预览、修改并保存回原工作区，无需切换应用。

![DSH Office](https://raw.githubusercontent.com/sunbigfly/dsh-office/main/docs/media/demo.gif?v=initial-010-dsh)

## 支持的文档

| 类型 | 格式 | 预览 | 编辑与保存 |
| --- | --- | :---: | :---: |
| Word | `.docx` | ✓ | ✓ |
| Excel | `.xlsx` | ✓ | ✓ |
| PowerPoint | `.pptx` | ✓ | ✓ |

Markdown 和其他文件保持 DSH 原生打开方式。

## 使用体验

- **工作区内完成**：默认进入预览，切换编辑后直接保存；支持 `Ctrl+S` / `⌘S`。
- **适应侧栏宽度**：预览和编辑共用菜单，窄屏自动收起溢出菜单，工具栏可横向滚动；`Ctrl`＋滚轮缩放文档。
- **界面紧凑**：中文菜单、90% 显示比例、字体搜索，任务面板与宠物默认隐藏。
- **保护当前修改**：提示未保存内容；检测到文件版本冲突时拒绝覆盖，保留当前页面内的草稿。

## 快速开始

1. 在有管理权限的 DSH 中，打开 **插件 → 实验性插件 → 自定义插件索引**。
2. 添加以下索引，在“发现”中搜索 **DSH Office**。

   ```text
   https://github.com/sunbigfly/dsh-office/releases/latest/download/index.json
   ```

3. 安装、启用并刷新页面，点击工作区中的 Office 文件。
4. 点击“编辑”开始修改，完成后点击“保存到工作区”。

也可从 [Releases](https://github.com/sunbigfly/dsh-office/releases/latest) 下载安装包；详细步骤见 [使用指南](docs/usage.md)。

## 部署与权限

DSH Office 独立安装、启停和卸载，可单独使用，也可配合多用户服务使用。管理员统一管理插件，成员在既有授权范围内使用。

文档由当前 DSH 读取和保存，不上传至 VibeOffice 网站。文件访问沿用宿主权限；共享目录当前支持预览，具体读写范围见 [文件和权限](docs/usage.md#文件和权限)。

- 已验证 **DSH 0.2.1-rc.2 · Node.js 22+**，单文件上限 **32 MiB**。
- 复杂版式与特殊 OOXML 功能的兼容性沿用上游，保存重要文档前请保留原件并核对结果。

[使用与开发](docs/usage.md) · [问题反馈](https://github.com/sunbigfly/dsh-office/issues)

[Apache-2.0](LICENSE) · 基于 [VibeOffice](https://github.com/tcchen2026/VibeOffice) · [第三方声明](NOTICE)
