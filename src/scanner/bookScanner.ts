import { Vault, TFile } from 'obsidian';
import { generateId, scanFiles, readFileBuffer } from '../utils/fileUtils';
import { extractEpubMeta } from '../metadata/epubExtractor';
import { extractPdfMeta } from '../metadata/pdfExtractor';
import type { BookMeta, BookShelfSettings } from '../types';

/**
 * 扫描指定目录，发现新书籍
 * @returns 新发现的书籍列表
 */
export async function scanBooks(
    vault: Vault,
    settings: BookShelfSettings,
    existingBooks: BookMeta[]
): Promise<BookMeta[]> {
    const newBooks: BookMeta[] = [];
    const existingPaths = new Set(existingBooks.map(b => b.filePath));

    for (const dir of settings.scanDirectories) {
        const files = await scanFiles(vault, dir, ['.epub', '.pdf']);

        for (const file of files) {
            // 跳过已存在的书籍
            if (existingPaths.has(file.path)) {
                continue;
            }

            try {
                const buffer = await readFileBuffer(vault, file);
                const ext = file.extension.toLowerCase();
                let bookMeta: BookMeta | null = null;

                if (ext === 'epub') {
                    bookMeta = await extractEpubMeta(buffer, file.path);
                } else if (ext === 'pdf') {
                    bookMeta = await extractPdfMeta(buffer, file.path);
                }

                if (bookMeta) {
                    // 设置默认值
                    bookMeta.id = generateId();
                    bookMeta.dateAdded = new Date().toISOString();
                    bookMeta.readingStatus = 'unread';
                    bookMeta.readingProgress = 0;
                    bookMeta.currentPosition = 0;
                    bookMeta.notePath = '';
                    bookMeta.rating = 0;
                    bookMeta.tags = [];
                    bookMeta.publisher = bookMeta.publisher || '';
                    bookMeta.isbn = bookMeta.isbn || '';
                    bookMeta.publishDate = bookMeta.publishDate || '';
                    bookMeta.description = bookMeta.description || '';
                    bookMeta.dateFinished = '';

                    newBooks.push(bookMeta);
                    existingPaths.add(file.path);
                }
            } catch (error) {
                console.warn(`Failed to process book: ${file.path}`, error);
            }
        }
    }

    return newBooks;
}

/**
 * 扫描并自动导入新书籍到插件数据
 */
export async function scanAndImport(
    vault: Vault,
    settings: BookShelfSettings,
    existingBooks: BookMeta[]
): Promise<BookMeta[]> {
    const newBooks = await scanBooks(vault, settings, existingBooks);
    return newBooks;
}
