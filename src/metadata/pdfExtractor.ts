import type { BookMeta } from '../types';

/**
 * 从 PDF 文件中提取元数据
 * 使用 pdf.js 读取文档信息和元数据
 */
export async function extractPdfMeta(
    buffer: ArrayBuffer,
    filePath: string
): Promise<BookMeta | null> {
    try {
        // 动态导入 pdfjs-dist
        const pdfjsLib = await import('pdfjs-dist');
        const loadingTask = pdfjsLib.getDocument({
            data: new Uint8Array(buffer),
            disableWorker: true,
        } as any);
        const pdfDoc = await loadingTask.promise;

        // 获取文档元数据
        const metadata = await pdfDoc.getMetadata();
        const info = metadata.info as Record<string, string>;

        const meta: Partial<BookMeta> = {
            format: 'pdf',
            filePath: filePath,
            title: info['Title'] || info['title'] || '',
            author: info['Author'] || info['author'] || '',
            publisher: info['Publisher'] || info['publisher'] || '',
            description: info['Subject'] || info['subject'] || info['Description'] || '',
            publishDate: extractPdfDate(info),
            isbn: '',
        };

        // 尝试在元数据中找 ISBN
        const allMetadataText = JSON.stringify(metadata).toLowerCase();
        const isbnMatch = allMetadataText.match(/\b(?:isbn[=:]?\s*)(\d{9}[\dx]|\d{13})\b/i)
            || JSON.stringify(info).match(/\b(\d{13}|\d{9}[\dX])\b/);
        if (isbnMatch) {
            meta.isbn = isbnMatch[1];
        }

        // 用文件名作为兜底书名
        if (!meta.title) {
            const fileName = filePath.split('/').pop()?.replace(/\.pdf$/i, '') || '';
            meta.title = fileName;
        }

        // 生成第一页缩略图作为封面
        try {
            meta.cover = await generatePdfThumbnail(pdfDoc);
        } catch {
            meta.cover = '';
        }

        // 从描述中提取可能的结构化信息
        if (meta.description) {
            meta.description = meta.description.replace(/\s+/g, ' ').trim();
        }

        await pdfDoc.destroy();

        return meta as BookMeta;
    } catch (error) {
        console.error(`Failed to extract PDF metadata from ${filePath}:`, error);
        // 基本回退：仅用文件名
        const fileName = filePath.split('/').pop()?.replace(/\.pdf$/i, '') || '';
        return {
            title: fileName,
            author: '',
            publisher: '',
            isbn: '',
            publishDate: '',
            description: '',
            cover: '',
            format: 'pdf',
            filePath: filePath,
        } as BookMeta;
    }
}

/**
 * 从 PDF info 中提取日期
 */
function extractPdfDate(info: Record<string, string>): string {
    const dateFields = ['CreationDate', 'creationDate', 'ModDate', 'modDate', 'Date', 'date'];
    for (const field of dateFields) {
        const value = info[field];
        if (value) {
            // PDF 日期格式: D:20230101000000Z 或 D:20230101000000+00'00'
            const match = value.match(/D:(\d{4})(\d{2})(\d{2})/);
            if (match) {
                return `${match[1]}-${match[2]}-${match[3]}`;
            }
            // 也尝试解析 ISO 日期
            const isoMatch = value.match(/(\d{4}-\d{2}-\d{2})/);
            if (isoMatch) {
                return isoMatch[1];
            }
        }
    }
    return '';
}

/**
 * 生成 PDF 第一页缩略图
 */
async function generatePdfThumbnail(pdfDoc: any): Promise<string> {
    try {
        const page = await pdfDoc.getPage(1);
        const viewport = page.getViewport({ scale: 0.3 }); // 缩略图尺寸

        // 使用离屏 canvas
        const canvas = new OffscreenCanvas(viewport.width, viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';

        await page.render({ canvasContext: ctx, viewport }).promise;

        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
        }
        return `data:image/jpeg;base64,${btoa(binary)}`;
    } catch {
        return '';
    }
}
