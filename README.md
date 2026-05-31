# 📚 BookShelf - Obsidian 个人书库插件

一个为 Obsidian 深度定制的个人电子书管理插件。支持 EPUB 和 PDF 格式，自动识别书籍信息，内建阅读器，读书笔记无缝整合 Obsidian 双链功能。

## ✨ 功能特性

### 📖 书籍管理
- **自动扫描**：将 EPUB/PDF 文件放入指定目录，插件自动发现并导入
- **元数据提取**：自动从文件中提取书名、作者、出版社、ISBN 等信息
- **在线补全**：通过 Open Library API（免费）自动补全缺失的书籍信息
- **手动添加**：无需文件也能手动创建书籍条目

### 📊 阅读状态追踪
- **三栏看板**：未读 / 在读 / 已读完，一目了然
- **拖拽切换**：将书籍卡片拖拽到不同状态栏，快速更新阅读状态
- **统计面板**：总藏书量、各状态数量实时显示

### 📖 内建阅读器
- **EPUB 阅读**：支持章节导航、目录浏览、字体大小调节、主题切换
- **PDF 阅读**：逐页渲染、缩放控制、页码跳转
- **标注系统**：选中文本即可高亮或添加笔记
- **进度记忆**：自动记住每本书的阅读位置

### 📝 笔记集成
- **自动创建**：每本书自动生成 Markdown 笔记文件
- **YAML 元数据**：笔记包含完整的 frontmatter 信息
- **双向链接**：标注摘录自动链接回笔记，支持 Obsidian 图谱视图
- **标注同步**：阅读中的高亮和批注自动同步到笔记文件

## 🚀 安装

### 手动安装
1. 下载最新发布版本
2. 解压到 Obsidian vault 的 `.obsidian/plugins/obsidian-book-shelf/` 目录
3. 在 Obsidian 设置 → 社区插件中启用 BookShelf

### 开发安装
```bash
cd obsidian-book-shelf
npm install
npm run dev
```

## 📋 使用指南

### 1. 配置
打开设置（Ctrl/Cmd+,）→ BookShelf，配置：
- **扫描目录**：存放书籍的文件夹（默认 `books`）
- **笔记目录**：读书笔记存放位置（默认 `book-notes`）
- **在线查询**：开启后自动联网补全书讯

### 2. 导入书籍
- 将 EPUB/PDF 文件放入扫描目录
- 使用命令面板（Ctrl+P）执行 `🔍 扫描书籍目录`
- 或开启"启动时自动扫描"

### 3. 管理书库
- **仪表盘**：`Ctrl+P` → `📊 打开书库仪表盘`
- **书库列表**：`Ctrl+P` → `📚 打开书库列表`
- **拖拽卡片**：在仪表盘中拖拽书籍到不同状态栏
- **右键菜单**：在书籍卡片上右键可快速切换状态

### 4. 阅读书籍
- 在仪表盘或书库列表中点击书籍封面
- EPUB：章节导航、字体调节、日间/夜间/护眼主题
- PDF：翻页控件、缩放、页码跳转
- 选中文字可高亮或添加笔记

### 5. 写读书笔记
- 每本书自动创建笔记文件（`book-notes/书名.md`）
- 阅读中的标注自动出现在笔记的「摘录与标注」章节
- 支持 Obsidian 双链语法，在笔记中 `[[书名]]` 即可引用其他书籍

## 🏗️ 技术架构

```
obsidian-book-shelf/
├── src/
│   ├── main.ts                # 插件入口
│   ├── settings.ts            # 设置面板
│   ├── types.ts               # 类型定义
│   ├── scanner/
│   │   └── bookScanner.ts     # 文件扫描
│   ├── metadata/
│   │   ├── epubExtractor.ts   # EPUB 元数据提取
│   │   ├── pdfExtractor.ts    # PDF 元数据提取
│   │   └── onlineLookup.ts    # Open Library 在线查询
│   ├── views/
│   │   ├── dashboardView.ts   # 仪表盘视图
│   │   ├── bookshelfSidebar.ts # 书库列表
│   │   └── readerPanel.ts     # 阅读面板
│   ├── reader/
│   │   ├── epubReader.ts      # EPUB 解析渲染
│   │   └── pdfReader.ts       # PDF 渲染
│   ├── notes/
│   │   ├── noteManager.ts     # 笔记创建管理
│   │   └── annotationSync.ts  # 标注同步
│   └── utils/
│       └── fileUtils.ts       # 工具函数
```

## 🔧 依赖

- `obsidian` - Obsidian API
- `jszip` - EPUB 文件解压
- `pdfjs-dist` - PDF 渲染

## 📄 许可

MIT License
