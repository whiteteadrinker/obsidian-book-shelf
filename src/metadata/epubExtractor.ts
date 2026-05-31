import JSZip from 'jszip';
import type { BookMeta } from '../types';

/**
 * 从 EPUB 文件中提取元数据
 * EPUB 本质是 ZIP 包，包含 META-INF/container.xml 指向 OPF 文件
 */
export async function extractEpubMeta(
    buffer: ArrayBuffer,
    filePath: string
): Promise<BookMeta | null> {
    try {
        const zip = await JSZip.loadAsync(buffer);

        // Step 1: 读取 META-INF/container.xml 找到 OPF 路径
        const containerFile = zip.file('META-INF/container.xml');
        if (!containerFile) {
            console.warn('No container.xml found in EPUB');
            return null;
        }

        const containerXml = await containerFile.async('text');
        const opfMatch = containerXml.match(/full-path="([^"]+)"/);
        if (!opfMatch) {
            console.warn('No OPF path found in container.xml');
            return null;
        }

        const opfPath = opfMatch[1];
        const opfFile = zip.file(opfPath);
        if (!opfFile) {
            console.warn(`OPF file not found: ${opfPath}`);
            return null;
        }

        const opfXml = await opfFile.async('text');

        // Step 2: 解析 OPF 元数据
        const meta: Partial<BookMeta> = {
            title: extractXmlTag(opfXml, 'dc:title'),
            author: extractXmlTag(opfXml, 'dc:creator'),
            publisher: extractXmlTag(opfXml, 'dc:publisher'),
            description: extractXmlTag(opfXml, 'dc:description'),
            publishDate: extractXmlTag(opfXml, 'dc:date'),
            format: 'epub',
            filePath: filePath,
        };

        // 提取 ISBN
        const identifiers = extractAllXmlTags(opfXml, 'dc:identifier');
        meta.isbn = findIsbn(identifiers);

        // 如果没找到 ISBN，再尝试用 text 内容搜索
        if (!meta.isbn) {
            const opfText = opfXml.replace(/<[^>]+>/g, ' ');
            const isbnMatch = opfText.match(/\b(?:ISBN(?:-1[03])?:?\s*)?(\d{9}[\dX]|\d{13})\b/i);
            if (isbnMatch) {
                meta.isbn = isbnMatch[1];
            }
        }

        // Step 3: 提取封面图片
        meta.cover = await extractEpubCover(zip, opfPath, opfXml);

        // 用文件名作为兜底书名
        if (!meta.title) {
            const fileName = filePath.split('/').pop()?.replace(/\.epub$/i, '') || '';
            meta.title = fileName;
        }

        // 清理 HTML 标签
        if (meta.description) {
            meta.description = meta.description.replace(/<[^>]+>/g, '').trim();
        }

        return meta as BookMeta;
    } catch (error) {
        console.error(`Failed to extract EPUB metadata from ${filePath}:`, error);
        return null;
    }
}

/**
 * 从 XML 文本中提取指定标签的内容
 */
function extractXmlTag(xml: string, tag: string): string {
    const regex = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : '';
}

/**
 * 从 XML 文本中提取所有指定标签的内容
 */
function extractAllXmlTags(xml: string, tag: string): string[] {
    const regex = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'gi');
    const results: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) {
        results.push(match[1].trim());
    }
    return results;
}

/**
 * 从标识符列表中查找 ISBN
 */
function findIsbn(identifiers: string[]): string {
    for (const id of identifiers) {
        // 纯数字 ISBN
        const isbnMatch = id.match(/\b(\d{9}[\dX]|\d{13})\b/i);
        if (isbnMatch) {
            return isbnMatch[1];
        }
    }
    return '';
}

/**
 * 从 EPUB 中提取封面图片
 */
async function extractEpubCover(
    zip: JSZip,
    opfPath: string,
    opfXml: string
): Promise<string> {
    try {
        // 从 OPF 中找封面 ID
        const metaCoverMatch = opfXml.match(/<meta\s+name="cover"\s+content="([^"]+)"/i);
        let coverId: string | null = null;

        if (metaCoverMatch) {
            coverId = metaCoverMatch[1];
        }

        // 从 manifest 中找封面项
        const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

        if (coverId) {
            const itemRegex = new RegExp(`<item[^>]*id="${coverId}"[^>]*href="([^"]+)"`, 'i');
            const itemMatch = opfXml.match(itemRegex);
            if (itemMatch) {
                const coverPath = opfDir + itemMatch[1];
                const coverFile = zip.file(coverPath);
                if (coverFile) {
                    const coverData = await coverFile.async('uint8array');
                    return `data:image/${getImageMime(coverPath)};base64,${uint8ToBase64(coverData)}`;
                }
            }
        }

        // Fallback: 常见封面文件名
        const commonCoverPatterns = [
            /cover\.(jpg|jpeg|png|gif)/i,
            /cover_page\.(jpg|jpeg|png|gif)/i,
            /titlepage\.(jpg|jpeg|png|gif)/i,
        ];

        for (const pattern of commonCoverPatterns) {
            for (const [filename] of Object.entries(zip.files)) {
                if (pattern.test(filename)) {
                    const coverFile = zip.file(filename);
                    if (coverFile) {
                        const coverData = await coverFile.async('uint8array');
                        return `data:image/${getImageMime(filename)};base64,${uint8ToBase64(coverData)}`;
                    }
                }
            }
        }
    } catch (error) {
        console.warn('Failed to extract EPUB cover:', error);
    }

    return '';
}

function getImageMime(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'png': return 'png';
        case 'gif': return 'gif';
        case 'webp': return 'webp';
        default: return 'jpeg';
    }
}

function uint8ToBase64(data: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
    }
    return btoa(binary);
}
