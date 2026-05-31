import JSZip from 'jszip';

/** EPUB 章节信息 */
export interface EpubChapter {
    /** 章节标题 */
    title: string;
    /** 章节 ID */
    id: string;
    /** 章节在 spine 中的索引 */
    index: number;
    /** HTML 内容 */
    html: string;
    /** 关联的 CSS */
    css: string[];
}

/** EPUB 书籍解析结果 */
export interface EpubBook {
    /** 书籍标题 */
    title: string;
    /** 章节列表 */
    chapters: EpubChapter[];
    /** 全局 CSS 内容 */
    globalCss: string;
    /** 目录 (TOC) */
    toc: EpubTocItem[];
    /** 封面图片 data URI */
    coverImage: string;
}

/** 目录项 */
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

        // 1. 读取 container.xml 获取 OPF 路径
        const containerFile = zip.file('META-INF/container.xml');
        if (!containerFile) {
            console.warn('No container.xml in EPUB');
            return null;
        }

        const containerXml = await containerFile.async('text');
        const opfMatch = containerXml.match(/full-path="([^"]+)"/);
        if (!opfMatch) return null;

        const opfPath = opfMatch[1];
        const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

        // 2. 解析 OPF
        const opfFile = zip.file(opfPath);
        if (!opfFile) return null;

        const opfXml = await opfFile.async('text');

        // 提取标题
        const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/i);
        const title = titleMatch ? titleMatch[1].trim() : 'Untitled';

        // 3. 解析 manifest (所有资源)
        const manifest = new Map<string, { href: string; mediaType: string }>();
        const manifestRegex = /<item[^>]*id="([^"]*)"[^>]*href="([^"]*)"[^>]*media-type="([^"]*)"/gi;
        let itemMatch: RegExpExecArray | null;
        while ((itemMatch = manifestRegex.exec(opfXml)) !== null) {
            manifest.set(itemMatch[1], {
                href: itemMatch[2],
                mediaType: itemMatch[3],
            });
        }

        // 4. 解析 spine (阅读顺序)
        const spineIds: string[] = [];
        const spineRegex = /<itemref[^>]*idref="([^"]*)"/gi;
        let spineMatch: RegExpExecArray | null;
        while ((spineMatch = spineRegex.exec(opfXml)) !== null) {
            spineIds.push(spineMatch[1]);
        }

        // 5. 收集所有 CSS 文件
        const allCss: string[] = [];
        for (const [, item] of manifest) {
            if (item.mediaType === 'text/css') {
                try {
                    const cssFile = zip.file(opfDir + item.href);
                    if (cssFile) {
                        const css = await cssFile.async('text');
                        allCss.push(css);
                    }
                } catch { /* skip invalid CSS */ }
            }
        }
        const globalCss = allCss.join('\n');

        // 6. 提取所有章节 HTML
        const chapters: EpubChapter[] = [];
        let chapterIndex = 0;

        for (const idref of spineIds) {
            const manifestItem = manifest.get(idref);
            if (!manifestItem) continue;

            const href = manifestItem.href;
            const fullPath = opfDir + href;

            // 只处理 XHTML/HTML 文件
            if (!manifestItem.mediaType.includes('xhtml') &&
                !manifestItem.mediaType.includes('html')) {
                continue;
            }

            try {
                const htmlFile = zip.file(fullPath);
                if (!htmlFile) continue;

                let html = await htmlFile.async('text');

                // 修复相对路径引用（图片、CSS 等）
                const chapterDir = fullPath.includes('/')
                    ? fullPath.substring(0, fullPath.lastIndexOf('/') + 1)
                    : '';

                // 提取章节标题
                let chapterTitle = `Chapter ${chapterIndex + 1}`;
                const h1Match = html.match(/<h1[^>]*>([^<]*)<\/h1>/i);
                if (h1Match) {
                    chapterTitle = h1Match[1].replace(/<[^>]+>/g, '').trim();
                } else {
                    const h2Match = html.match(/<h2[^>]*>([^<]*)<\/h2>/i);
                    if (h2Match) {
                        chapterTitle = h2Match[1].replace(/<[^>]+>/g, '').trim();
                    } else {
                        const titleTagMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
                        if (titleTagMatch) {
                            chapterTitle = titleTagMatch[1].replace(/<[^>]+>/g, '').trim();
                        }
                    }
                }

                // 收集此章节引用的本地 CSS
                const chapterCss: string[] = [];
                const cssLinkRegex = /<link[^>]*href="([^"]*\.css)"[^>]*\/?>/gi;
                let cssMatch: RegExpExecArray | null;
                while ((cssMatch = cssLinkRegex.exec(html)) !== null) {
                    const cssPath = chapterDir + cssMatch[1];
                    try {
                        const cssFile = zip.file(cssPath);
                        if (cssFile) {
                            const css = await cssFile.async('text');
                            chapterCss.push(css);
                        }
                    } catch { /* skip */ }
                }

                // 移除 <script> 标签（安全考虑）
                html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

                chapters.push({
                    title: chapterTitle,
                    id: idref,
                    index: chapterIndex,
                    html: html,
                    css: chapterCss,
                });

                chapterIndex++;
            } catch (error) {
                console.warn(`Failed to process chapter: ${idref}`, error);
            }
        }

        // 7. 解析 TOC (NCX 或 NAV)
        let toc: EpubTocItem[] = [];
        try {
            // 先尝试 NCX
            const ncxItem = [...manifest.values()].find(i => i.mediaType === 'application/x-dtbncx+xml');
            if (ncxItem) {
                const ncxFile = zip.file(opfDir + ncxItem.href);
                if (ncxFile) {
                    const ncxXml = await ncxFile.async('text');
                    toc = parseNcxToc(ncxXml);
                }
            }
            // 如果没有 NCX，尝试 NAV (EPUB3)
            if (toc.length === 0) {
                const navItem = [...manifest.values()].find(i =>
                    i.mediaType === 'application/xhtml+xml' && i.href.includes('nav'));
                if (navItem) {
                    const navFile = zip.file(opfDir + navItem.href);
                    if (navFile) {
                        const navHtml = await navFile.async('text');
                        toc = parseNavToc(navHtml);
                    }
                }
            }
        } catch { /* TOC is optional */ }

        // 如果没有 TOC，用章节列表生成
        if (toc.length === 0) {
            toc = chapters.map(ch => ({
                title: ch.title,
                href: `#chapter-${ch.index}`,
                children: [],
            }));
        }

        // 8. 提取封面
        let coverImage = '';
        try {
            const coverMeta = opfXml.match(/<meta\s+name="cover"\s+content="([^"]+)"/i);
            if (coverMeta) {
                const coverManifestItem = manifest.get(coverMeta[1]);
                if (coverManifestItem) {
                    const coverFile = zip.file(opfDir + coverManifestItem.href);
                    if (coverFile) {
                        const coverData = await coverFile.async('uint8array');
                        coverImage = `data:image/${
                            coverManifestItem.href.endsWith('.png') ? 'png' : 'jpeg'
                        };base64,${uint8ToBase64(coverData)}`;
                    }
                }
            }
        } catch { /* cover optional */ }

        return {
            title,
            chapters,
            globalCss,
            toc,
            coverImage,
        };
    } catch (error) {
        console.error('Failed to parse EPUB:', error);
        return null;
    }
}

/**
 * 解析 NCX 格式的目录
 */
function parseNcxToc(xml: string): EpubTocItem[] {
    const items: EpubTocItem[] = [];
    const navPointRegex = /<navPoint[^>]*id="([^"]*)"[^>]*>[\s\S]*?<navLabel>[\s\S]*?<text>([^<]*)<\/text>[\s\S]*?<content[^>]*src="([^"]*)"[\s\S]*?<\/navPoint>/gi;

    let match: RegExpExecArray | null;
    while ((match = navPointRegex.exec(xml)) !== null) {
        items.push({
            title: match[2].trim(),
            href: match[3],
            children: [],
        });
    }

    return items;
}

/**
 * 解析 NAV (EPUB3) 格式的目录
 */
function parseNavToc(html: string): EpubTocItem[] {
    const items: EpubTocItem[] = [];
    const liRegex = /<li[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;

    let match: RegExpExecArray | null;
    while ((match = liRegex.exec(html)) !== null) {
        items.push({
            title: match[2].trim(),
            href: match[1],
            children: [],
        });
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
