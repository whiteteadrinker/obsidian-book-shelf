import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import type BookShelfPlugin from '../main';
import type { BookMeta } from '../types';
import { parseEpubBook } from '../reader/epubReader';
import type { EpubBook, EpubChapter } from '../reader/epubReader';
import { loadPdfDocument, renderPdfPage, createPaginationControls, createZoomControls } from '../reader/pdfReader';

export const READER_VIEW_TYPE = 'bookshelf-reader-view';

interface Highlight {
    id: string;
    bookId: string;
    chapterIndex: number;
    text: string;
    note: string;
    color: string;
    timestamp: string;
}

export class ReaderPanelView extends ItemView {
    plugin: BookShelfPlugin;
    private currentBook: BookMeta | null = null;
    private epubBook: EpubBook | null = null;
    private pdfDoc: any = null;
    private currentChapterIndex: number = 0;
    private pdfCurrentPage: number = 1;
    private pdfScale: number = 1.0;
    private fontSize: number = 16;
    private theme: 'light' | 'dark' | 'sepia' = 'light';
    private highlights: Highlight[] = [];
    private showToc: boolean = false;
    private iframeEl: HTMLIFrameElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: BookShelfPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string { return READER_VIEW_TYPE; }
    getDisplayText(): string {
        return this.currentBook ? `${this.currentBook.title}` : 'BookShelf Reader';
    }
    getIcon(): string { return 'book-open'; }

    async onOpen(): Promise<void> {
        this.fontSize = this.plugin.settings.epubFontSize;
        this.theme = this.plugin.settings.epubTheme;
        this.render();
    }

    async onClose(): Promise<void> {
        if (this.currentBook) {
            const totalChapters = this.epubBook?.chapters.length || 1;
            const progress = Math.round((this.currentChapterIndex / totalChapters) * 100);
            await this.plugin.setReadingProgress(this.currentBook.id, progress, this.currentChapterIndex);
        }
    }

    // ===== 加载书籍 =====

    async loadBook(book: BookMeta): Promise<void> {
        this.currentBook = book;
        this.epubBook = null;
        this.pdfDoc = null;
        this.iframeEl = null;
        this.currentChapterIndex = 0;

        if (!book.filePath) {
            this.render();
            return;
        }

        try {
            const file = this.plugin.app.vault.getAbstractFileByPath(book.filePath);
            if (!file) {
                new Notice(`❌ 文件不存在: ${book.filePath}`);
                this.render();
                return;
            }

            const buffer = await this.plugin.app.vault.readBinary(file as any);

            if (book.format === 'epub') {
                this.epubBook = await parseEpubBook(buffer);
                if (!this.epubBook) {
                    new Notice('❌ 无法解析 EPUB 文件，请检查文件格式');
                } else {
                    console.log(`[BookShelf] EPUB loaded: "${this.epubBook.title}", ${this.epubBook.chapters.length} chapters`);
                }
            } else if (book.format === 'pdf') {
                this.pdfDoc = await loadPdfDocument(buffer);
                this.pdfCurrentPage = book.currentPosition > 0 ? book.currentPosition : 1;
            }
        } catch (error) {
            console.error(`[BookShelf] Failed to load ${book.format}:`, error);
            new Notice(`❌ 无法加载书籍: ${error instanceof Error ? error.message : '未知错误'}`);
        }

        // 恢复上次位置
        if (book.currentPosition > 0 && book.format === 'epub') {
            this.currentChapterIndex = Math.min(book.currentPosition, (this.epubBook?.chapters.length || 1) - 1);
        }

        this.render();
    }

    // ===== 主渲染 =====

    render(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('bookshelf-reader');

        if (!this.currentBook) {
            container.createDiv({ cls: 'bookshelf-reader-empty', text: '请从书库中选择一本书开始阅读' });
            return;
        }

        if (!this.epubBook && !this.pdfDoc) {
            container.createDiv({ cls: 'bookshelf-reader-empty', text: '正在加载书籍内容...' });
            return;
        }

        this.renderToolbar(container);

        const mainArea = container.createDiv('bookshelf-reader-main');
        mainArea.style.display = 'flex';
        mainArea.style.flex = '1';
        mainArea.style.overflow = 'hidden';
        mainArea.style.minHeight = '0';

        if (this.showToc && this.epubBook) {
            this.renderToc(mainArea);
        }

        this.renderContent(mainArea);
    }

    // ===== 工具栏 =====

    private renderToolbar(container: HTMLElement): void {
        const toolbar = container.createDiv('bookshelf-reader-toolbar');
        const isPdf = this.currentBook?.format === 'pdf';

        if (!isPdf && this.epubBook) {
            // 目录按钮
            const tocBtn = toolbar.createEl('button', { text: '☰ 目录' });
            tocBtn.addEventListener('click', () => { this.showToc = !this.showToc; this.render(); });

            // 上一章
            const prevBtn = toolbar.createEl('button', { text: '◀' });
            prevBtn.addEventListener('click', () => {
                if (this.currentChapterIndex > 0) {
                    this.currentChapterIndex--;
                    this.renderChapter();
                }
            });

            // 章节信息
            toolbar.createEl('span', {
                text: `${this.currentChapterIndex + 1} / ${this.epubBook.chapters.length}`,
                attr: { style: 'margin:0 8px;font-size:13px;color:var(--text-muted);' },
            });
            if (this.epubBook.chapters[this.currentChapterIndex]) {
                toolbar.createEl('span', {
                    text: this.epubBook.chapters[this.currentChapterIndex].title,
                    attr: { style: 'font-size:13px;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' },
                });
            }

            // 下一章
            const nextBtn = toolbar.createEl('button', { text: '▶' });
            nextBtn.addEventListener('click', () => {
                if (this.currentChapterIndex < this.epubBook!.chapters.length - 1) {
                    this.currentChapterIndex++;
                    this.renderChapter();
                }
            });

            toolbar.createEl('span', { text: '|', attr: { style: 'color:var(--text-faint);margin:0 8px;' } });

            // 字号
            const decBtn = toolbar.createEl('button', { text: 'A⁻' });
            decBtn.addEventListener('click', () => { this.fontSize = Math.max(12, this.fontSize - 1); this.renderChapter(); });
            const incBtn = toolbar.createEl('button', { text: 'A⁺' });
            incBtn.addEventListener('click', () => { this.fontSize = Math.min(24, this.fontSize + 1); this.renderChapter(); });

            // 主题
            const themeSel = toolbar.createEl('select');
            themeSel.createEl('option', { text: '日间', attr: { value: 'light' } });
            themeSel.createEl('option', { text: '夜间', attr: { value: 'dark' } });
            themeSel.createEl('option', { text: '护眼', attr: { value: 'sepia' } });
            themeSel.value = this.theme;
            themeSel.addEventListener('change', () => {
                this.theme = themeSel.value as 'light' | 'dark' | 'sepia';
                this.renderChapter();
            });
        } else if (isPdf && this.pdfDoc) {
            createZoomControls(toolbar, this.pdfScale, (s) => { this.pdfScale = s; this.renderPdfPage(); });
            toolbar.createEl('span', {
                text: `📄 ${this.pdfCurrentPage} / ${this.pdfDoc.numPages}`,
                attr: { style: 'font-size:13px;margin:0 8px;' },
            });
        }

        toolbar.createEl('span', { attr: { style: 'flex:1;' } });
        const closeBtn = toolbar.createEl('button', { text: '✕' });
        closeBtn.addEventListener('click', () => this.leaf.detach());
    }

    // ===== TOC =====

    private renderToc(container: HTMLElement): void {
        const tocDiv = container.createDiv('bookshelf-toc');
        tocDiv.style.cssText = 'width:220px;flex-shrink:0;overflow-y:auto;padding:8px;border-right:1px solid var(--background-modifier-border);';
        if (!this.epubBook) return;

        for (const item of this.epubBook.toc) {
            const row = tocDiv.createDiv('bookshelf-toc-item');
            row.setText(item.title);
            const idx = this.epubBook.chapters.findIndex(ch =>
                item.href.includes(ch.id) || ch.title.includes(item.title));
            if (idx >= 0) {
                if (idx === this.currentChapterIndex) row.addClass('active');
                row.style.cursor = 'pointer';
                row.addEventListener('click', () => { this.currentChapterIndex = idx; this.renderChapter(); this.showToc = false; this.render(); });
            }
        }
    }

    // ===== 内容渲染 =====

    private renderContent(container: HTMLElement): void {
        const existing = container.querySelector('.bookshelf-reader-content');
        if (existing) existing.remove();

        if (this.currentBook?.format === 'pdf' && this.pdfDoc) {
            this.renderPdfContent(container);
        } else if (this.epubBook && this.epubBook.chapters.length > 0) {
            this.renderEpubContent(container);
        } else {
            container.createDiv({ cls: 'bookshelf-reader-content', text: '无法加载书籍内容' });
        }
    }

    /** 渲染 EPUB 内容 — 使用 iframe 隔离 */
    private renderEpubContent(container: HTMLElement): void {
        if (!this.epubBook) return;
        const chapter = this.epubBook.chapters[this.currentChapterIndex];
        if (!chapter) return;

        const contentDiv = container.createDiv('bookshelf-reader-content');

        // 构建完整的 HTML 文档给 iframe
        const docHtml = this.buildIframeDoc(chapter);
        const iframe = contentDiv.createEl('iframe');
        iframe.style.cssText = 'width:100%;height:100%;border:none;';
        iframe.setAttribute('sandbox', 'allow-scripts');
        iframe.srcdoc = docHtml;

        this.iframeEl = iframe;

        // 更新进度
        this.updateProgress(chapter);
    }

    /** 构建 iframe 的完整 HTML 文档 */
    private buildIframeDoc(chapter: EpubChapter): string {
        const bgColors: Record<string, string> = {
            light: '#ffffff',
            dark: '#1e1e1e',
            sepia: '#f4ecd8',
        };
        const textColors: Record<string, string> = {
            light: '#333333',
            dark: '#d4d4d4',
            sepia: '#5b4636',
        };
        const bg = bgColors[this.theme] || '#ffffff';
        const fg = textColors[this.theme] || '#333333';

        const allCss = [
            this.epubBook?.globalCss || '',
            ...chapter.css,
        ].join('\n');

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    * { box-sizing: border-box; }
    body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: ${this.fontSize}px;
        line-height: 1.85;
        color: ${fg};
        background: ${bg};
        padding: 16px 24px;
        max-width: 860px;
        margin: 0 auto;
        word-break: break-word;
    }
    img { max-width: 100%; height: auto; display: block; margin: 12px auto; }
    svg { max-width: 100%; height: auto; }
    h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin-top: 1.2em; margin-bottom: 0.6em; }
    p { margin: 0.8em 0; }
    blockquote { margin: 1em 0; padding: 0.5em 1em; border-left: 3px solid #ccc; color: #666; }
    pre { overflow-x: auto; background: rgba(0,0,0,0.05); padding: 12px; border-radius: 4px; font-size: 0.9em; }
    code { background: rgba(0,0,0,0.05); padding: 1px 4px; border-radius: 2px; font-size: 0.9em; }
    a { color: var(--text-accent, #4078f2); }
    .bookshelf-highlight {
        background-color: rgba(255, 212, 0, 0.35);
        border-bottom: 1px solid rgba(255, 180, 0, 0.5);
        cursor: pointer;
    }
    ${allCss}
</style>
</head>
<body>
${chapter.bodyHtml}
</body>
</html>`;
    }

    /** 仅重新渲染当前章节（不重绘整个 toolbar） */
    private renderChapter(): void {
        const mainArea = this.containerEl.querySelector('.bookshelf-reader-main') as HTMLElement;
        if (!mainArea) { this.render(); return; }

        // 更新 toolbar 中的章节信息
        const toolbar = this.containerEl.querySelector('.bookshelf-reader-toolbar');
        if (toolbar && this.epubBook) {
            const spans = toolbar.querySelectorAll('span');
            for (const span of spans) {
                if (span.textContent?.includes('/')) {
                    span.setText(`${this.currentChapterIndex + 1} / ${this.epubBook.chapters.length}`);
                    break;
                }
            }
        }

        // 移除旧 TOC
        const oldToc = mainArea.querySelector('.bookshelf-toc');
        if (oldToc) oldToc.remove();

        // 重新渲染 TOC（如果在显示）
        if (this.showToc && this.epubBook) {
            this.renderToc(mainArea);
            // 更新 active 状态
            const tocItems = mainArea.querySelectorAll('.bookshelf-toc-item');
            tocItems.forEach((item, i) => {
                item.removeClass('active');
                const tocEntry = this.epubBook!.toc[i];
                if (tocEntry) {
                    const idx = this.epubBook!.chapters.findIndex(ch =>
                        tocEntry.href.includes(ch.id) || ch.title.includes(tocEntry.title));
                    if (idx === this.currentChapterIndex) item.addClass('active');
                }
            });
        }

        // 重新渲染内容
        this.renderContent(mainArea);
        this.scrollToTop();
    }

    /** PDF 内容渲染 */
    private async renderPdfContent(container: HTMLElement): Promise<void> {
        const contentDiv = container.createDiv('bookshelf-reader-content');
        contentDiv.addClass('bookshelf-pdf-container');

        createPaginationControls(contentDiv, this.pdfCurrentPage, this.pdfDoc.numPages, (page) => {
            this.pdfCurrentPage = page;
            this.renderPdfPage();
            this.updatePdfProgress();
        });

        const pageContainer = contentDiv.createDiv('bookshelf-pdf-page-container');
        pageContainer.style.cssText = 'flex:1;display:flex;justify-content:center;padding:16px;overflow:auto;';
        await this.renderPdfPage(pageContainer);

        createPaginationControls(contentDiv, this.pdfCurrentPage, this.pdfDoc.numPages, (page) => {
            this.pdfCurrentPage = page;
            this.renderPdfPage(pageContainer);
            this.updatePdfProgress();
        });
    }

    private async renderPdfPage(container?: HTMLElement): Promise<void> {
        if (!this.pdfDoc) return;
        if (!container) {
            container = this.containerEl.querySelector('.bookshelf-pdf-page-container') as HTMLElement;
        }
        if (!container) return;
        await renderPdfPage(this.pdfDoc, this.pdfCurrentPage, container, this.pdfScale);
    }

    private updatePdfProgress(): void {
        if (!this.currentBook || !this.pdfDoc) return;
        const progress = Math.round((this.pdfCurrentPage / this.pdfDoc.numPages) * 100);
        this.plugin.setReadingProgress(this.currentBook.id, progress, this.pdfCurrentPage);
    }

    // ===== 进度 =====

    private scrollToTop(): void {
        const content = this.containerEl.querySelector('.bookshelf-reader-content');
        if (content) content.scrollTop = 0;
    }

    private updateProgress(chapter: EpubChapter): void {
        if (!this.currentBook || !this.epubBook) return;
        const total = this.epubBook.chapters.length;
        const progress = Math.round(((chapter.index + 1) / total) * 100);
        this.plugin.setReadingProgress(this.currentBook.id, progress, chapter.index);
    }

    getHighlights(): Highlight[] { return [...this.highlights]; }
}
