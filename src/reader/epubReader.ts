import JSZip from 'jszip';

/** EPUB 章节信息 */
export interface EpubChapter {
    title: string;
    id: string;
    index: number;
    /** 仅 body 内的 HTML 片段 */
    bodyHtml: string;
    /** 此章节引用/内联的 CSS */
    css: string[];
}

/** EPUB 书籍解析结果 */
export interface EpubBook {
    title: string;
    chapters: EpubChapter[];
    globalCss: string;
    toc: EpubTocItem[];
    coverImage: string;
}

export interface EpubTocItem {
    title: string;
    href: string;
    children: EpubTocItem[];
}

/**
 * 解析 EPUB 文件，提取可阅读的内容
 */
export async function parseEpubBook(buffer: ArrayBuffer): Promise<EpubBook | null> {
    try {
        const zip = await JSZip.loadAsync(buffer);

        // === 1. 读取 container.xml 获取 OPF 路径 ===
        const containerFile = zip.file('META-INF/container.xml');
        if (!containerFile) {
            console.warn('[BookShelf] No META-INF/container.xml in EPUB');
            return null;
        }

        const containerXml = await containerFile.async('text');
        const opfMatch = containerXml.match(/full-path="([^"]+)"/);
        if (!opfMatch) {
            console.warn('[BookShelf] No OPF path in container.xml');
            return null;
        }

        const opfPath = opfMatch[1];
        const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

        // === 2. 解析 OPF ===
        const opfFile = zip.file(opfPath);
        if (!opfFile) {
            console.warn(`[BookShelf] OPF file not found: ${opfPath}`);
            return null;
        }

        const opfXml = await opfFile.async('text');

        // 提取标题
        const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/i);
        const title = titleMatch ? titleMatch[1].trim() : 'Untitled';

        // === 3. 解析 manifest (所有资源 ID → 路径) ===
        const manifest = new Map<string, { href: string; mediaType: string }>();
        const manifestRegex = /<item[^>]*\bid="([^"]*)"[^>]*\bhref="([^"]*)"[^>]*\bmedia-type="([^"]*)"/gi;
        let m: RegExpExecArray | null;
        while ((m = manifestRegex.exec(opfXml)) !== null) {
            manifest.set(m[1], { href: m[2], mediaType: m[3] });
        }

        // === 4. 解析 spine (阅读顺序) ===
        const spineIds: string[] = [];
        const spineRegex = /<itemref[^>]*\bidref="([^"]*)"/gi;
        let s: RegExpExecArray | null;
        while ((s = spineRegex.exec(opfXml)) !== null) {
            spineIds.push(s[1]);
        }

        // === 5. 收集全局 CSS ===
        const allCss: string[] = [];
        for (const [, item] of manifest) {
            if (item.mediaType === 'text/css') {
                try {
                    const cssFile = zip.file(resolveZipPath(opfDir, item.href));
                    if (cssFile) {
                        allCss.push(await cssFile.async('text'));
                    }
                } catch { /* skip */ }
            }
        }

        // === 6. 提取章节 body 内容 ===
        const chapters: EpubChapter[] = [];
        let chapterIndex = 0;

        for (const idref of spineIds) {
            const manifestItem = manifest.get(idref);
            if (!manifestItem) continue;
            if (!manifestItem.mediaType.includes('xhtml') && !manifestItem.mediaType.includes('html')) continue;

            try {
                const fullPath = resolveZipPath(opfDir, manifestItem.href);
                const htmlFile = zip.file(fullPath);
                if (!htmlFile) continue;

                const rawHtml = await htmlFile.async('text');
                const chapterDir = fullPath.includes('/')
                    ? fullPath.substring(0, fullPath.lastIndexOf('/') + 1)
                    : '';

                // 提取 body 内容 + head 中的 style
                const { bodyHtml, headCss } = extractBodyContent(rawHtml);

                // 提取章节标题
                const chapterTitle = extractChapterTitle(rawHtml, chapterIndex);

                // 收集此章节链接的 CSS
                const chapterCss = [...headCss];
                const cssLinkRegex = /<link[^>]*href="([^"]*\.css)"[^>]*\/?>/gi;
                let cl: RegExpExecArray | null;
                while ((cl = cssLinkRegex.exec(rawHtml)) !== null) {
                    const cssPath = resolveZipPath(chapterDir, cl[1]);
                    try {
                        const cssFile = zip.file(cssPath);
                        if (cssFile) chapterCss.push(await cssFile.async('text'));
                    } catch { /* skip */ }
                }

                chapters.push({
                    title: chapterTitle,
                    id: idref,
                    index: chapterIndex,
                    bodyHtml,
                    css: chapterCss,
                });
                chapterIndex++;
            } catch (error) {
                console.warn(`[BookShelf] Failed to process chapter ${idref}:`, error);
            }
        }

        if (chapters.length === 0) {
            console.warn('[BookShelf] No readable chapters found in EPUB');
            return null;
        }

        // === 7. 解析 TOC ===
        let toc: EpubTocItem[] = [];
        try {
            const ncxItem = [...manifest.values()].find(i => i.mediaType === 'application/x-dtbncx+xml');
            if (ncxItem) {
                const f = zip.file(resolveZipPath(opfDir, ncxItem.href));
                if (f) toc = parseNcxToc(await f.async('text'));
            }
            if (toc.length === 0) {
                const navItem = [...manifest.values()].find(i =>
                    i.mediaType === 'application/xhtml+xml' && /nav/i.test(i.href));
                if (navItem) {
                    const f = zip.file(resolveZipPath(opfDir, navItem.href));
                    if (f) toc = parseNavToc(await f.async('text'));
                }
            }
        } catch { /* optional */ }

        if (toc.length === 0) {
            toc = chapters.map(ch => ({ title: ch.title, href: `#ch-${ch.index}`, children: [] }));
        }

        // === 8. 封面 ===
        let coverImage = '';
        try {
            const coverMeta = opfXml.match(/<meta\s+name="cover"\s+content="([^"]+)"/i);
            if (coverMeta) {
                const cmi = manifest.get(coverMeta[1]);
                if (cmi) {
                    const cf = zip.file(resolveZipPath(opfDir, cmi.href));
                    if (cf) {
                        const cd = await cf.async('uint8array');
                        const ext = cmi.href.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpeg';
                        coverImage = `data:image/${ext};base64,${uint8ToBase64(cd)}`;
                    }
                }
            }
        } catch { /* optional */ }

        return { title, chapters, globalCss: allCss.join('\n'), toc, coverImage };
    } catch (error) {
        console.error('[BookShelf] Failed to parse EPUB:', error);
        return null;
    }
}

// ===== 辅助函数 =====

/** 从 XHTML 中提取 body 内容 + head 中的 style */
function extractBodyContent(html: string): { bodyHtml: string; headCss: string[] } {
    const headCss: string[] = [];

    // 提取 head 中的 <style> 块
    const headStyleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let hs: RegExpExecArray | null;
    while ((hs = headStyleRegex.exec(html)) !== null) {
        headCss.push(hs[1]);
    }

    // 提取 body 内容
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) {
        // 移除 body 内嵌的 style 块（会通过 headCss 或内联方式处理）
        let bodyHtml = bodyMatch[1];
        // 不移除 body 内的 style，保留它们
        return { bodyHtml, headCss };
    }

    // 没有 body 标签：直接清理掉 XML 声明和 DOCTYPE
    let cleaned = html
        .replace(/<\?xml[^?]*\?>/, '')
        .replace(/<!DOCTYPE[^>]*>/i, '')
        .replace(/<html[^>]*>/i, '')
        .replace(/<\/html>/i, '')
        .replace(/<head[^>]*>[\s\S]*?<\/head>/i, '')
        .trim();

    return { bodyHtml: cleaned, headCss };
}

/** 从 HTML 中提取章节标题 */
function extractChapterTitle(html: string, index: number): string {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) return stripTags(h1Match[1]).trim() || `Chapter ${index + 1}`;

    const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (h2Match) return stripTags(h2Match[1]).trim() || `Chapter ${index + 1}`;

    const h3Match = html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (h3Match) return stripTags(h3Match[1]).trim() || `Chapter ${index + 1}`;

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) return stripTags(titleMatch[1]).trim() || `Chapter ${index + 1}`;

    return `Chapter ${index + 1}`;
}

function stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
}

/**
 * 解析 ZIP 内的路径，处理相对路径和特殊字符
 */
function resolveZipPath(baseDir: string, href: string): string {
    // URL decode the href (EPUB specs allow URL-encoded paths)
    let decoded = href;
    try {
        decoded = decodeURIComponent(href);
    } catch { /* not encoded */ }

    // 去掉 fragment
    const hashIdx = decoded.indexOf('#');
    if (hashIdx >= 0) decoded = decoded.substring(0, hashIdx);

    // 如果已经是绝对路径格式
    if (decoded.startsWith('/')) return decoded.substring(1);

    // 处理 ../ 相对路径
    const combined = baseDir + decoded;
    const parts = combined.split('/');
    const resolved: string[] = [];
    for (const part of parts) {
        if (part === '..') {
            resolved.pop();
        } else if (part !== '.' && part !== '') {
            resolved.push(part);
        }
    }
    return resolved.join('/');
}

/** 解析 NCX 目录 */
function parseNcxToc(xml: string): EpubTocItem[] {
    const items: EpubTocItem[] = [];
    const regex = /<navPoint[^>]*>[\s\S]*?<navLabel>[\s\S]*?<text>([^<]*)<\/text>[\s\S]*?<content[^>]*src="([^"]*)"[\s\S]*?<\/navPoint>/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(xml)) !== null) {
        items.push({ title: m[1].trim(), href: m[2], children: [] });
    }
    return items;
}

/** 解析 NAV (EPUB3) 目录 */
function parseNavToc(html: string): EpubTocItem[] {
    const items: EpubTocItem[] = [];
    const regex = /<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null) {
        const title = m[2].replace(/<[^>]+>/g, '').trim();
        if (title) items.push({ title, href: m[1], children: [] });
    }
    return items;
}

function uint8ToBase64(data: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
    }
    return btoa(binary);
}
