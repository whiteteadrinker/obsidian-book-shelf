import { Vault, TFile, normalizePath } from 'obsidian';
import { sanitizeFileName, ensureDirectory } from '../utils/fileUtils';
import type { BookMeta, BookShelfSettings } from '../types';

/**
 * 为书籍创建笔记文件
 * @returns 笔记文件的 vault 路径
 */
export async function createBookNote(
    vault: Vault,
    book: BookMeta,
    settings: BookShelfSettings
): Promise<string> {
    const notesDir = settings.notesDirectory || 'book-notes';
    await ensureDirectory(vault, notesDir);

    const safeTitle = sanitizeFileName(book.title);
    const notePath = normalizePath(`${notesDir}/${safeTitle}.md`);

    // 检查是否已存在
    const existing = vault.getAbstractFileByPath(notePath);
    if (existing instanceof TFile) {
        return notePath;
    }

    // 生成笔记内容
    const content = generateNoteContent(book, settings.noteTemplate);

    try {
        await vault.create(notePath, content);
        return notePath;
    } catch (error) {
        console.error(`Failed to create note for "${book.title}":`, error);

        // 如果文件已存在（竞态条件），返回路径
        const retry = vault.getAbstractFileByPath(notePath);
        if (retry instanceof TFile) {
            return notePath;
        }
        return '';
    }
}

/**
 * 根据模板生成笔记内容
 */
function generateNoteContent(book: BookMeta, template: string): string {
    let content = template;

    const replacements: Record<string, string> = {
        '{{title}}': book.title,
        '{{author}}': book.author || '未知作者',
        '{{publisher}}': book.publisher || '未知出版社',
        '{{isbn}}': book.isbn || '',
        '{{publishDate}}': book.publishDate || '',
        '{{rating}}': String(book.rating > 0 ? '⭐'.repeat(book.rating) : '未评分'),
        '{{readingStatus}}': readingStatusLabel(book.readingStatus),
        '{{tags}}': book.tags.length > 0 ? book.tags.join(', ') : '书籍',
        '{{dateAdded}}': formatDate(book.dateAdded),
        '{{dateFinished}}': book.dateFinished ? formatDate(book.dateFinished) : '',
        '{{description}}': book.description || '暂无简介',
    };

    for (const [key, value] of Object.entries(replacements)) {
        content = content.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
    }

    // 如果 book.cover 是 data URI（太长），不写入 frontmatter
    // 保持模板简洁

    return content;
}

/**
 * 更新笔记文件的元数据（frontmatter）
 */
export async function updateNoteFrontmatter(
    vault: Vault,
    notePath: string,
    book: BookMeta
): Promise<void> {
    const file = vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return;

    try {
        const content = await vault.read(file);
        let updated = content;

        // 更新 YAML frontmatter 中的字段
        const fmUpdates: Record<string, string> = {
            'title:': `title: "${book.title}"`,
            'author:': `author: "${book.author || '未知作者'}"`,
            'status:': `status: ${readingStatusLabel(book.readingStatus)}`,
            'rating:': `rating: ${book.rating}`,
        };

        for (const [pattern, replacement] of Object.entries(fmUpdates)) {
            const regex = new RegExp(`^${pattern}.*$`, 'm');
            if (regex.test(updated)) {
                updated = updated.replace(regex, replacement);
            }
        }

        if (updated !== content) {
            await vault.modify(file, updated);
        }
    } catch (error) {
        console.error(`Failed to update note frontmatter for ${notePath}:`, error);
    }
}

/**
 * 将高亮标注追加到笔记文件
 */
export async function appendHighlightsToNote(
    vault: Vault,
    notePath: string,
    highlights: Array<{
        text: string;
        note: string;
        chapterTitle?: string;
        timestamp: string;
    }>
): Promise<void> {
    const file = vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return;

    try {
        let content = await vault.read(file);

        // 确保有「摘录与标注」章节
        if (!content.includes('## 📌 摘录与标注')) {
            content += '\n\n## 📌 摘录与标注\n\n';
        }

        // 追加新标注
        let newSection = '';
        for (const hl of highlights) {
            newSection += `\n> ${hl.text}\n`;
            if (hl.chapterTitle) {
                newSection += `> — *${hl.chapterTitle}*`;
                if (hl.timestamp) {
                    newSection += ` (${formatDate(hl.timestamp)})`;
                }
                newSection += '\n';
            }
            if (hl.note) {
                newSection += `\n💭 ${hl.note}\n`;
            }
            newSection += '\n---\n';
        }

        content += newSection;
        await vault.modify(file, content);
    } catch (error) {
        console.error(`Failed to append highlights to ${notePath}:`, error);
    }
}

/**
 * 确保书籍有关联的笔记文件
 * 如果没有就创建一个，返回笔记路径
 */
export async function ensureBookNote(
    vault: Vault,
    book: BookMeta,
    settings: BookShelfSettings
): Promise<string> {
    if (book.notePath) {
        const existing = vault.getAbstractFileByPath(book.notePath);
        if (existing instanceof TFile) {
            return book.notePath;
        }
    }

    // 尝试用 sanitized 标题查找已存在的笔记
    const safeTitle = sanitizeFileName(book.title);
    const notesDir = settings.notesDirectory || 'book-notes';
    const notePath = normalizePath(`${notesDir}/${safeTitle}.md`);
    const existing = vault.getAbstractFileByPath(notePath);
    if (existing instanceof TFile) {
        return notePath;
    }

    // 创建新笔记
    return await createBookNote(vault, book, settings);
}

// === 辅助函数 ===

function readingStatusLabel(status: string): string {
    switch (status) {
        case 'unread': return '未读';
        case 'reading': return '在读';
        case 'finished': return '已读完';
        default: return status;
    }
}

function formatDate(isoString: string): string {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        return date.toISOString().split('T')[0];
    } catch {
        return isoString;
    }
}

/**
 * 在笔记文件中建立书籍之间的关联链接
 */
export async function linkBookNotes(
    vault: Vault,
    books: BookMeta[]
): Promise<void> {
    // 为相关书籍创建"相关链接"区域
    // 按作者分组，同一作者的书互相链接
    const byAuthor = new Map<string, BookMeta[]>();
    for (const book of books) {
        if (!book.author || !book.notePath) continue;
        const existing = byAuthor.get(book.author) || [];
        existing.push(book);
        byAuthor.set(book.author, existing);
    }

    for (const [, authorBooks] of byAuthor) {
        if (authorBooks.length < 2) continue;

        for (const book of authorBooks) {
            if (!book.notePath) continue;
            const file = vault.getAbstractFileByPath(book.notePath);
            if (!(file instanceof TFile)) continue;

            try {
                let content = await vault.read(file);

                // 添加相关链接部分
                const otherBooks = authorBooks.filter(b => b.id !== book.id && b.notePath);
                if (otherBooks.length === 0) continue;

                if (!content.includes('## 🏷️ 同作者其他书籍')) {
                    content += '\n\n## 🏷️ 同作者其他书籍\n\n';
                    for (const other of otherBooks) {
                        const otherFileName = other.notePath.replace(/\.md$/, '').split('/').pop();
                        content += `- [[${otherFileName}|${other.title}]]\n`;
                    }
                    await vault.modify(file, content);
                }
            } catch {
                // 单本失败不影响其他
            }
        }
    }
}
