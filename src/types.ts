/** 阅读状态 */
export type ReadingStatus = 'unread' | 'reading' | 'finished';

/** 书籍格式 */
export type BookFormat = 'epub' | 'pdf' | 'manual';

/** 书籍元数据 */
export interface BookMeta {
    /** 唯一标识 */
    id: string;
    /** 书名 */
    title: string;
    /** 作者 */
    author: string;
    /** 出版社 */
    publisher: string;
    /** ISBN */
    isbn: string;
    /** 出版日期 */
    publishDate: string;
    /** 描述/简介 */
    description: string;
    /** 封面图片路径（vault 内相对路径或 data URI） */
    cover: string;
    /** 书籍格式 */
    format: BookFormat;
    /** 书籍文件在 vault 中的路径（手动添加的书籍可为空） */
    filePath: string;
    /** 阅读状态 */
    readingStatus: ReadingStatus;
    /** 阅读进度 (0-100) */
    readingProgress: number;
    /** 当前阅读位置（EPUB: 章节索引, PDF: 页码） */
    currentPosition: number;
    /** 添加到书库的日期 (ISO string) */
    dateAdded: string;
    /** 读完的日期 (ISO string) */
    dateFinished: string;
    /** 用户评分 (1-5) */
    rating: number;
    /** 用户标签 */
    tags: string[];
    /** 关联的笔记文件路径 */
    notePath: string;
}

/** 插件设置 */
export interface BookShelfSettings {
    /** 书籍文件扫描目录（相对于 vault 根目录） */
    scanDirectories: string[];
    /** 笔记存放目录 */
    notesDirectory: string;
    /** 是否启用在线查询 */
    enableOnlineLookup: boolean;
    /** Open Library 查询超时 (ms) */
    lookupTimeout: number;
    /** 启动时自动扫描 */
    autoScanOnStartup: boolean;
    /** 默认视图：dashboard | sidebar */
    defaultView: 'dashboard' | 'sidebar';
    /** 笔记模板 */
    noteTemplate: string;
    /** EPUB 阅读器字体大小 */
    epubFontSize: number;
    /** EPUB 阅读器主题 */
    epubTheme: 'light' | 'dark' | 'sepia';
}

/** 插件全局数据（存储在 data.json 中的完整数据） */
export interface BookShelfPluginData {
    settings: BookShelfSettings;
    books: BookMeta[];
}

/** 默认设置 */
export const DEFAULT_SETTINGS: BookShelfSettings = {
    scanDirectories: ['books'],
    notesDirectory: 'book-notes',
    enableOnlineLookup: true,
    lookupTimeout: 10000,
    autoScanOnStartup: true,
    defaultView: 'dashboard',
    noteTemplate: `---
title: "{{title}}"
author: "{{author}}"
publisher: "{{publisher}}"
isbn: "{{isbn}}"
publishDate: "{{publishDate}}"
rating: {{rating}}
status: {{readingStatus}}
tags: [{{tags}}]
added: "{{dateAdded}}"
finished: "{{dateFinished}}"
---

# {{title}}

## 📖 书籍信息

| 项目 | 内容 |
|------|------|
| 作者 | {{author}} |
| 出版社 | {{publisher}} |
| ISBN | {{isbn}} |
| 出版日期 | {{publishDate}} |

## 📝 简介

{{description}}

## ✍️ 读书笔记

---

## 📌 摘录与标注

> 阅读时的高亮和批注会自动添加到这里。

---

## 🏷️ 相关链接

- 返回 [[书库仪表盘]]
`,
    epubFontSize: 16,
    epubTheme: 'light',
};
