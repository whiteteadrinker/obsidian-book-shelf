import { containsChinese } from '../utils/fileUtils';
import type { BookMeta } from '../types';

/** Open Library 搜索结果 */
interface OpenLibrarySearchDoc {
    title: string;
    author_name?: string[];
    publisher?: string[];
    isbn?: string[];
    first_publish_year?: number;
    cover_i?: number;
    number_of_pages_median?: number;
}

interface OpenLibrarySearchResult {
    numFound: number;
    docs: OpenLibrarySearchDoc[];
}

/** Open Library ISBN 查询结果 */
interface OpenLibraryBookResult {
    title?: string;
    authors?: Array<{ key: string }>;
    publishers?: Array<{ name: string }>;
    publish_date?: string;
    isbn_13?: string[];
    isbn_10?: string[];
    description?: string | { value: string };
    covers?: number[];
    number_of_pages?: number;
}

/**
 * 在线查询书籍元数据，补全缺失信息
 * 使用 Open Library API（免费，无需 API key）
 */
export async function lookupBookOnline(
    book: BookMeta,
    timeout: number
): Promise<Partial<BookMeta>> {
    const result: Partial<BookMeta> = {};

    try {
        // 优先用 ISBN 查询
        if (book.isbn) {
            const isbnData = await lookupByIsbn(book.isbn, timeout);
            if (isbnData) {
                Object.assign(result, isbnData);
            }
        }

        // 如果 ISBN 查不到或没有 ISBN，用书名+作者搜索
        if (!result.title && !result.description) {
            const searchData = await searchByTitleAuthor(
                book.title,
                book.author,
                timeout
            );
            if (searchData) {
                // 只在字段为空时填充
                mergeIfEmpty(result, searchData);
            }
        }

        // 尝试下载封面
        if (!book.cover && result.cover) {
            // cover 字段已在返回数据中处理
        }

        return result;
    } catch (error) {
        console.warn('Online lookup failed:', error);
        return {};
    }
}

/**
 * 通过 ISBN 查询 Open Library
 */
async function lookupByIsbn(
    isbn: string,
    timeout: number
): Promise<Partial<BookMeta> | null> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(
            `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`,
            { signal: controller.signal }
        );
        clearTimeout(timer);

        if (!response.ok) return null;

        const data: OpenLibraryBookResult = await response.json();
        const result: Partial<BookMeta> = {};

        if (data.title) {
            result.title = data.title;
        }
        if (data.authors && data.authors.length > 0) {
            // 获取作者名称
            try {
                const authorResponse = await fetch(
                    `https://openlibrary.org${data.authors[0].key}.json`,
                    { signal: AbortSignal.timeout(timeout) }
                );
                if (authorResponse.ok) {
                    const authorData = await authorResponse.json();
                    result.author = authorData.name || '';
                }
            } catch {
                // 作者查询失败，跳过
            }
        }
        if (data.publishers && data.publishers.length > 0) {
            result.publisher = data.publishers[0].name;
        }
        if (data.publish_date) {
            result.publishDate = data.publish_date;
        }
        if (data.description) {
            result.description = typeof data.description === 'string'
                ? data.description
                : (data.description.value || '');
        }
        if (data.isbn_13 && data.isbn_13.length > 0) {
            result.isbn = data.isbn_13[0];
        }
        // 封面
        if (data.covers && data.covers.length > 0) {
            result.cover = `https://covers.openlibrary.org/b/id/${data.covers[0]}-M.jpg`;
        }

        return result;
    } catch {
        return null;
    }
}

/**
 * 通过书名+作者搜索 Open Library
 */
async function searchByTitleAuthor(
    title: string,
    author: string,
    timeout: number
): Promise<Partial<BookMeta> | null> {
    try {
        let query = title;
        if (author) {
            query = `${title} ${author}`;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(
            `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=3`,
            { signal: controller.signal }
        );
        clearTimeout(timer);

        if (!response.ok) return null;

        const data: OpenLibrarySearchResult = await response.json();
        if (!data.docs || data.docs.length === 0) return null;

        // 选择最佳匹配
        const bestMatch = selectBestMatch(data.docs, title, author);

        const result: Partial<BookMeta> = {};

        if (bestMatch.publisher && bestMatch.publisher.length > 0) {
            result.publisher = bestMatch.publisher[0];
        }
        if (bestMatch.isbn && bestMatch.isbn.length > 0) {
            result.isbn = bestMatch.isbn[0];
        }
        if (bestMatch.first_publish_year) {
            result.publishDate = String(bestMatch.first_publish_year);
        }
        if (bestMatch.cover_i) {
            result.cover = `https://covers.openlibrary.org/b/id/${bestMatch.cover_i}-M.jpg`;
        }

        // 对搜索结果的描述进行补充查询
        if (bestMatch.isbn && bestMatch.isbn.length > 0) {
            const descResult = await lookupDescriptionByIsbn(bestMatch.isbn[0], timeout);
            if (descResult) {
                result.description = descResult;
            }
        }

        return result;
    } catch {
        return null;
    }
}

/**
 * 查询书籍描述
 */
async function lookupDescriptionByIsbn(
    isbn: string,
    timeout: number
): Promise<string | null> {
    try {
        const response = await fetch(
            `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`,
            { signal: AbortSignal.timeout(timeout) }
        );
        if (!response.ok) return null;

        const data: OpenLibraryBookResult = await response.json();
        if (data.description) {
            return typeof data.description === 'string'
                ? data.description
                : (data.description.value || '');
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * 从搜索结果中选择最佳匹配
 */
function selectBestMatch(
    docs: OpenLibrarySearchDoc[],
    title: string,
    author: string
): OpenLibrarySearchDoc {
    if (docs.length === 1) return docs[0];

    // 按书名相似度排序（简单的包含匹配）
    const titleLower = title.toLowerCase();
    const authorLower = author.toLowerCase();

    const scored = docs.map(doc => {
        let score = 0;
        const docTitle = (doc.title || '').toLowerCase();

        // 书名精确匹配
        if (docTitle === titleLower) score += 10;
        else if (docTitle.includes(titleLower) || titleLower.includes(docTitle)) score += 5;

        // 作者匹配
        if (authorLower && doc.author_name) {
            const docAuthors = doc.author_name.map(a => a.toLowerCase());
            if (docAuthors.some(a => a === authorLower)) score += 10;
            else if (docAuthors.some(a => a.includes(authorLower) || authorLower.includes(a))) score += 5;
        }

        // 有 ISBN 加分
        if (doc.isbn && doc.isbn.length > 0) score += 3;
        // 有封面加分
        if (doc.cover_i) score += 2;
        // 有出版社加分
        if (doc.publisher && doc.publisher.length > 0) score += 1;

        return { doc, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].doc;
}

/**
 * 合并元数据：source 中非空的字段覆盖 target 中的空字段
 */
function mergeIfEmpty(target: Partial<BookMeta>, source: Partial<BookMeta>): void {
    for (const key of Object.keys(source) as (keyof BookMeta)[]) {
        const targetVal = target[key];
        const sourceVal = source[key];
        if ((targetVal === undefined || targetVal === '' || targetVal === null) &&
            sourceVal !== undefined && sourceVal !== '' && sourceVal !== null) {
            (target as any)[key] = sourceVal;
        }
    }
}

/**
 * 对已有书籍批量在线查询补全
 */
export async function batchLookupBooks(
    books: BookMeta[],
    timeout: number,
    onProgress?: (current: number, total: number) => void
): Promise<Map<string, Partial<BookMeta>>> {
    const results = new Map<string, Partial<BookMeta>>();
    let completed = 0;

    for (const book of books) {
        // 跳过已有完整信息的书籍
        if (book.publisher && book.description && book.cover) {
            completed++;
            continue;
        }

        try {
            const result = await lookupBookOnline(book, timeout);
            if (Object.keys(result).length > 0) {
                results.set(book.id, result);
            }
        } catch {
            // 单本书查询失败不影响整体
        }

        completed++;
        onProgress?.(completed, books.length);
    }

    return results;
}
