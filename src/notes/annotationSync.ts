import { Vault } from 'obsidian';
import { appendHighlightsToNote } from './noteManager';

/** 标注数据 */
export interface Annotation {
    id: string;
    bookId: string;
    /** 原始文本 */
    text: string;
    /** 用户笔记 */
    note: string;
    /** 章节标题（EPUB）或页码（PDF） */
    location: string;
    /** 标注颜色 */
    color: string;
    /** 时间戳 */
    timestamp: string;
}

/**
 * 将标注同步到笔记文件
 */
export async function syncAnnotations(
    vault: Vault,
    notePath: string,
    annotations: Annotation[]
): Promise<void> {
    if (annotations.length === 0) return;

    const highlightsForNote = annotations.map(a => ({
        text: a.text,
        note: a.note,
        chapterTitle: a.location,
        timestamp: a.timestamp,
    }));

    await appendHighlightsToNote(vault, notePath, highlightsForNote);
}

/**
 * 将标注导出为单独的 Markdown 摘录文件
 */
export async function exportAnnotationsAsNote(
    vault: Vault,
    bookTitle: string,
    annotations: Annotation[],
    outputDir: string
): Promise<string> {
    if (annotations.length === 0) return '';

    const sanitized = bookTitle.replace(/[\\/:*?"<>|]/g, '_');
    const filePath = `${outputDir}/${sanitized} - 摘录.md`;

    let content = `# ${bookTitle} - 摘录笔记\n\n`;
    content += `> 导出时间: ${new Date().toLocaleString()}\n`;
    content += `> 共 ${annotations.length} 条摘录\n\n---\n\n`;

    for (const ann of annotations) {
        content += `> ${ann.text}\n\n`;
        if (ann.note) {
            content += `💭 ${ann.note}\n\n`;
        }
        if (ann.location) {
            content += `📍 ${ann.location}\n\n`;
        }
        content += `*${new Date(ann.timestamp).toLocaleString()}*\n\n`;
        content += `---\n\n`;
    }

    try {
        await vault.create(filePath, content);
        return filePath;
    } catch {
        return '';
    }
}

/**
 * 生成标注的 Obsidian 双链格式文本
 * 从笔记中引用原文的具体位置
 */
export function generateAnnotationLink(
    noteFileName: string,
    annotation: Annotation
): string {
    // 例如: [[三体#第一章|三体 - 第一章摘录]]
    const bookName = noteFileName.replace(/\.md$/, '');
    const locationAnchor = annotation.location
        ? `#${annotation.location.replace(/[^a-zA-Z0-9一-鿿]/g, '')}`
        : '';
    return `[[${bookName}${locationAnchor}|📌 摘录]]`;
}

/**
 * 从高亮文本中提取关键概念作为标签
 */
export function extractTagsFromAnnotation(text: string): string[] {
    const tags: string[] = [];
    // 简单的概念提取：寻找引号中的内容
    const quotedRegex = /「([^」]+)」|"([^"]+)"|'([^']+)'/g;
    let match;
    while ((match = quotedRegex.exec(text)) !== null) {
        const concept = (match[1] || match[2] || match[3]).trim();
        if (concept.length > 1 && concept.length < 20) {
            tags.push(`#${concept}`);
        }
    }
    return tags;
}
