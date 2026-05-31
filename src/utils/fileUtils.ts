import { normalizePath, Vault, TFile, TFolder } from 'obsidian';

/**
 * 生成唯一 ID
 */
export function generateId(): string {
    return 'book-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
}

/**
 * 清理文件名中的非法字符
 */
export function sanitizeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

/**
 * 检测文本是否包含中文字符
 */
export function containsChinese(text: string): boolean {
    return /[一-鿿㐀-䶿]/.test(text);
}

/**
 * 确保目录存在，不存在则创建
 */
export async function ensureDirectory(vault: Vault, dirPath: string): Promise<void> {
    const normalized = normalizePath(dirPath);
    const folder = vault.getAbstractFileByPath(normalized);
    if (!folder) {
        await vault.createFolder(normalized);
    }
}

/**
 * 获取书籍封面图片的 data URI
 * 如果封面已存储为 vault 中的文件，返回其 vault 路径
 */
export async function saveCoverImage(
    vault: Vault,
    coverDir: string,
    bookId: string,
    coverData: Uint8Array | null,
    format: string
): Promise<string> {
    if (!coverData || coverData.length === 0) {
        return '';
    }

    await ensureDirectory(vault, coverDir);

    const ext = format === 'jpeg' ? 'jpg' : 'png';
    const coverPath = normalizePath(`${coverDir}/${bookId}.${ext}`);

    // 检查是否已存在
    const existing = vault.getAbstractFileByPath(coverPath);
    if (existing) {
        return coverPath;
    }

    try {
        await vault.createBinary(coverPath, coverData.buffer as ArrayBuffer);
        return coverPath;
    } catch {
        // 如果写入失败，返回空
        return '';
    }
}

/**
 * 递归扫描目录获取指定后缀的文件
 */
export async function scanFiles(
    vault: Vault,
    dirPath: string,
    extensions: string[]
): Promise<TFile[]> {
    const normalized = normalizePath(dirPath);
    const folder = vault.getAbstractFileByPath(normalized);

    if (!folder || !(folder instanceof TFolder)) {
        return [];
    }

    const result: TFile[] = [];

    const recurse = (f: TFolder) => {
        for (const child of f.children) {
            if (child instanceof TFile) {
                const ext = '.' + child.extension.toLowerCase();
                if (extensions.includes(ext)) {
                    result.push(child);
                }
            } else if (child instanceof TFolder) {
                recurse(child);
            }
        }
    };

    recurse(folder);
    return result;
}

/**
 * 读取文件的 ArrayBuffer
 */
export async function readFileBuffer(vault: Vault, file: TFile): Promise<ArrayBuffer> {
    return await vault.readBinary(file);
}
