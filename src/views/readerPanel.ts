import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import type BookShelfPlugin from '../main';
import type { BookMeta } from '../types';
import { parseEpubBook } from '../reader/epubReader';
import type { EpubBook, EpubChapter } from '../reader/epubReader';
import { loadPdfDocument, renderPdfPage, createPaginationControls, createZoomControls } from '../reader/pdfReader';

export const READER_VIEW_TYPE = 'bookshelf-reader-view';

/** 高亮/标注数据 */
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

    constructor(leaf: WorkspaceLeaf, plugin: BookShelfPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return READER_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.currentBook ? `📖 ${this.currentBook.title}` : 'BookShelf Reader';
    }

    getIcon(): string {
        return 'book-open';
    }

    async onOpen(): Promise<void> {
        this.fontSize = this.plugin.settings.epubFontSize;
        this.theme = this.plugin.settings.epubTheme;
        this.render();
    }

    async onClose(): Promise<void> {
        // 保存阅读进度
        if (this.currentBook && this.currentChapterIndex >= 0) {
            const totalChapters = this.epubBook?.chapters.length || 1;
            const progress = Math.round((this.currentChapterIndex / totalChapters) * 100);
            await this.plugin.setReadingProgress(
                this.currentBook.id,
                progress,
                this.currentChapterIndex
            );
        }
    }

    /** 加载并打开一本书 */
    async loadBook(book: BookMeta): Promise<void> {
        this.currentBook = book;
        this.epubBook = null;
        this.pdfDoc = null;

        if (book.filePath) {
            try {
                const file = this.plugin.app.vault.getAbstractFileByPath(book.filePath);
                if (file) {
                    const buffer = await this.plugin.app.vault.readBinary(file as any);

                    if (book.format === 'epub') {
                        this.epubBook = await parseEpubBook(buffer);
                    } else if (book.format === 'pdf') {
                        this.pdfDoc = await loadPdfDocument(buffer);
                        this.pdfCurrentPage = book.currentPosition > 0 ? book.currentPosition : 1;
                    }
                }
            } catch (error) {
                console.error(`Failed to load ${book.format.toUpperCase()}:`, error);
                new Notice(`❌ 无法加载 ${book.format.toUpperCase()} 文件`);
            }
        }

        // 恢复到上次阅读位置（EPUB）
        if (book.currentPosition > 0 && book.format === 'epub') {
            this.currentChapterIndex = book.currentPosition;
        }

        // 刷新内容
        this.render();
    }

    /** 渲染阅读器 */
    render(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('bookshelf-reader');

        if (!this.currentBook) {
            container.createDiv({
                cls: 'bookshelf-reader-empty',
                text: '请从书库中选择一本书开始阅读',
            });
            return;
        }

        if (!this.epubBook && !this.pdfDoc) {
            container.createDiv({
                cls: 'bookshelf-reader-empty',
                text: '正在加载书籍内容...',
            });
            return;
        }

        // 工具栏
        this.renderToolbar(container);

        // 主内容区域
        const mainArea = container.createDiv('bookshelf-reader-main');
        mainArea.style.display = 'flex';
        mainArea.style.flex = '1';
        mainArea.style.overflow = 'hidden';

        // TOC 侧边栏（仅 EPUB）
        if (this.showToc && this.epubBook) {
            this.renderToc(mainArea);
        }

        // 阅读内容
        this.renderContent(mainArea);
    }

    /** 渲染工具栏 */
    private renderToolbar(container: HTMLElement): void {
        const toolbar = container.createDiv('bookshelf-reader-toolbar');
        const isPdf = this.currentBook?.format === 'pdf';

        if (!isPdf && this.epubBook) {
            // EPUB 工具栏
            const tocBtn = toolbar.createEl('button', { text: '☰ 目录' });
            tocBtn.addEventListener('click', () => {
                this.showToc = !this.showToc;
                this.render();
            });

            const prevBtn = toolbar.createEl('button', { text: '◀ 上一章' });
            prevBtn.addEventListener('click', () => {
                if (this.currentChapterIndex > 0) {
                    this.currentChapterIndex--;
                    this.render();
                    this.scrollToTop();
                }
            });

            const chapterInfo = toolbar.createEl('span');
            chapterInfo.style.margin = '0 8px';
            chapterInfo.style.fontSize = '13px';
            chapterInfo.style.color = 'var(--text-muted)';
            chapterInfo.setText(
                `${this.currentChapterIndex + 1} / ${this.epubBook.chapters.length}`
            );

            const nextBtn = toolbar.createEl('button', { text: '下一章 ▶' });
            nextBtn.addEventListener('click', () => {
                if (this.currentChapterIndex < this.epubBook!.chapters.length - 1) {
                    this.currentChapterIndex++;
                    this.render();
                    this.scrollToTop();
                }
            });

            toolbar.createEl('span', { text: '|', attr: { style: 'color: var(--text-faint); margin: 0 8px;' } });

            const fontSizeBtn = toolbar.createEl('button', { text: 'A-' });
            fontSizeBtn.addEventListener('click', () => {
                this.fontSize = Math.max(12, this.fontSize - 2);
                this.render();
            });
            const fontSizePlusBtn = toolbar.createEl('button', { text: 'A+' });
            fontSizePlusBtn.addEventListener('click', () => {
                this.fontSize = Math.min(24, this.fontSize + 2);
                this.render();
            });

            const themeSelect = toolbar.createEl('select');
            themeSelect.createEl('option', { text: '☀️ 日间', attr: { value: 'light' } });
            themeSelect.createEl('option', { text: '🌙 夜间', attr: { value: 'dark' } });
            themeSelect.createEl('option', { text: '📜 护眼', attr: { value: 'sepia' } });
            themeSelect.value = this.theme;
            themeSelect.addEventListener('change', () => {
                this.theme = themeSelect.value as 'light' | 'dark' | 'sepia';
                this.render();
            });
        } else if (isPdf && this.pdfDoc) {
            // PDF 缩放控件
            createZoomControls(toolbar, this.pdfScale, (newScale) => {
                this.pdfScale = newScale;
                this.renderPdfPage();
            });

            toolbar.createEl('span', { text: '|', attr: { style: 'color: var(--text-faint); margin: 0 8px;' } });
            toolbar.createEl('span', {
                text: `📄 ${this.pdfCurrentPage} / ${this.pdfDoc.numPages}`,
                attr: { style: 'font-size: 13px;' },
            });
        }

        // 关闭按钮
        toolbar.createEl('span', { attr: { style: 'flex:1;' } });
        const closeBtn = toolbar.createEl('button', { text: '✕ 关闭' });
        closeBtn.addEventListener('click', () => {
            this.leaf.detach();
        });
    }

    /** 渲染目录 */
    private renderToc(container: HTMLElement): void {
        const tocDiv = container.createDiv('bookshelf-toc');
        tocDiv.style.width = '220px';
        tocDiv.style.flexShrink = '0';

        if (!this.epubBook) return;

        for (const item of this.epubBook.toc) {
            const tocItem = tocDiv.createDiv('bookshelf-toc-item');
            tocItem.setText(item.title);
            // 尝试匹配章节
            const chapterIdx = this.epubBook.chapters.findIndex(ch =>
                item.href.includes(ch.id) || ch.title.includes(item.title)
            );
            if (chapterIdx >= 0) {
                if (chapterIdx === this.currentChapterIndex) {
                    tocItem.addClass('active');
                }
                tocItem.addEventListener('click', () => {
                    this.currentChapterIndex = chapterIdx;
                    this.render();
                    this.scrollToTop();
                });
            }

            // 子项
            for (const child of item.children) {
                const childItem = tocDiv.createDiv('bookshelf-toc-item is-sub');
                childItem.setText(child.title);
                const childIdx = this.epubBook.chapters.findIndex(ch =>
                    child.href.includes(ch.id) || ch.title.includes(child.title)
                );
                if (childIdx >= 0) {
                    if (childIdx === this.currentChapterIndex) {
                        childItem.addClass('active');
                    }
                    childItem.addEventListener('click', () => {
                        this.currentChapterIndex = childIdx;
                        this.render();
                        this.scrollToTop();
                    });
                }
            }
        }
    }

    /** 渲染阅读内容 */
    private renderContent(container: HTMLElement): void {
        // 移除旧内容
        const existing = container.querySelector('.bookshelf-reader-content');
        if (existing) existing.remove();

        const isPdf = this.currentBook?.format === 'pdf';

        if (isPdf && this.pdfDoc) {
            this.renderPdfContent(container);
        } else if (this.epubBook && this.epubBook.chapters.length > 0) {
            this.renderEpubContent(container);
        } else {
            container.createDiv({
                cls: 'bookshelf-reader-content',
                text: '无法加载书籍内容',
            });
        }
    }

    /** 渲染 PDF 内容 */
    private async renderPdfContent(container: HTMLElement): Promise<void> {
        const contentDiv = container.createDiv('bookshelf-reader-content');
        contentDiv.addClass('bookshelf-pdf-container');

        // 分页导航（上方）
        createPaginationControls(
            contentDiv,
            this.pdfCurrentPage,
            this.pdfDoc.numPages,
            (page) => {
                this.pdfCurrentPage = page;
                this.renderPdfPage();
                this.updatePdfProgress();
            }
        );

        // PDF 页面容器
        const pageContainer = contentDiv.createDiv('bookshelf-pdf-page-container');
        pageContainer.style.flex = '1';
        pageContainer.style.display = 'flex';
        pageContainer.style.justifyContent = 'center';
        pageContainer.style.padding = '16px';

        await this.renderPdfPage(pageContainer);

        // 分页导航（下方）
        createPaginationControls(
            contentDiv,
            this.pdfCurrentPage,
            this.pdfDoc.numPages,
            (page) => {
                this.pdfCurrentPage = page;
                this.renderPdfPage(pageContainer);
                this.updatePdfProgress();
            }
        );
    }

    /** 渲染单个 PDF 页面 */
    private async renderPdfPage(container?: HTMLElement): Promise<void> {
        if (!this.pdfDoc) return;

        if (!container) {
            container = this.containerEl.querySelector('.bookshelf-pdf-page-container') as HTMLElement;
        }
        if (!container) return;

        await renderPdfPage(this.pdfDoc, this.pdfCurrentPage, container, this.pdfScale);
    }

    /** 更新 PDF 阅读进度 */
    private updatePdfProgress(): void {
        if (!this.currentBook || !this.pdfDoc) return;
        const progress = Math.round((this.pdfCurrentPage / this.pdfDoc.numPages) * 100);
        this.plugin.setReadingProgress(this.currentBook.id, progress, this.pdfCurrentPage);
    }

    /** 渲染 EPUB 内容 */
    private renderEpubContent(container: HTMLElement): void {
        if (!this.epubBook || this.epubBook.chapters.length === 0) return;

        const chapter = this.epubBook.chapters[this.currentChapterIndex];
        if (!chapter) return;

        const contentDiv = container.createDiv('bookshelf-reader-content');
        contentDiv.addClass(`bookshelf-epub-content ${this.theme}`);
        contentDiv.style.setProperty('--bookshelf-font-size', `${this.fontSize}px`);

        // 将 HTML 注入到内容区域
        const wrapper = contentDiv.createDiv('bookshelf-epub-inner');
        wrapper.innerHTML = this.sanitizeHtml(chapter.html, chapter);

        // 设置文本选择事件
        wrapper.addEventListener('mouseup', (e) => {
            this.handleTextSelection(e, chapter);
        });

        // 记录阅读进度
        this.updateProgress(chapter);
    }

    /** HTML 安全处理 */
    private sanitizeHtml(html: string, chapter: EpubChapter): string {
        // 注入 CSS
        let cssBlock = this.epubBook?.globalCss || '';
        if (chapter.css.length > 0) {
            cssBlock += '\n' + chapter.css.join('\n');
        }

        let result = html;

        // 注入引用 CSS
        if (cssBlock) {
            result = `<style>${cssBlock}</style>` + result;
        }

        // 注入阅读器特定样式
        result = `<style>
            body {
                font-size: ${this.fontSize}px;
                line-height: 1.8;
                max-width: 100%;
            }
            img {
                max-width: 100%;
                height: auto;
            }
            .bookshelf-highlight {
                background-color: rgba(255, 212, 0, 0.3);
                border-bottom: 1px solid rgba(255, 212, 0, 0.6);
            }
            .bookshelf-highlight.with-note {
                background-color: rgba(100, 180, 255, 0.3);
                border-bottom: 1px solid rgba(100, 180, 255, 0.6);
            }
        </style>` + result;

        return result;
    }

    /** 处理文本选择 */
    private handleTextSelection(event: MouseEvent, chapter: EpubChapter): void {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.toString().trim()) {
            return;
        }

        const selectedText = selection.toString().trim();
        if (selectedText.length < 2) return;

        // 移除已有的弹出菜单
        const existingPopup = document.querySelector('.bookshelf-annotation-popup');
        if (existingPopup) existingPopup.remove();

        // 创建标注弹出菜单
        const popup = document.createElement('div');
        popup.addClass('bookshelf-annotation-popup');
        popup.style.left = `${event.clientX - 50}px`;
        popup.style.top = `${event.clientY - 40}px`;

        // 高亮按钮
        const highlightBtn = popup.createEl('button', { text: '🖍️ 高亮' });
        highlightBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.addHighlight(selectedText, chapter, '');
            popup.remove();
            selection.removeAllRanges();
        });

        // 高亮+笔记按钮
        const noteBtn = popup.createEl('button', { text: '📝 笔记' });
        noteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const note = prompt('添加笔记:', '');
            if (note !== null) {
                this.addHighlight(selectedText, chapter, note);
            }
            popup.remove();
            selection.removeAllRanges();
        });

        document.body.appendChild(popup);

        // 点击其他地方关闭
        const closePopup = (e: Event) => {
            if (!popup.contains(e.target as Node)) {
                popup.remove();
                document.removeEventListener('click', closePopup);
            }
        };
        setTimeout(() => document.addEventListener('click', closePopup), 10);
    }

    /** 添加高亮 */
    private addHighlight(text: string, chapter: EpubChapter, note: string): void {
        if (!this.currentBook) return;

        const highlight: Highlight = {
            id: `hl-${Date.now()}`,
            bookId: this.currentBook.id,
            chapterIndex: chapter.index,
            text,
            note,
            color: note ? 'blue' : 'yellow',
            timestamp: new Date().toISOString(),
        };

        this.highlights.push(highlight);

        // 高亮选中文本
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const span = document.createElement('span');
            span.addClass(note ? 'bookshelf-highlight with-note' : 'bookshelf-highlight');
            span.setAttribute('data-highlight-id', highlight.id);
            try {
                range.surroundContents(span);
            } catch {
                // surroundContents 在跨元素时可能失败
            }
        }

        new Notice(note ? '✅ 已添加高亮和笔记' : '✅ 已高亮');
    }

    /** 应用字体大小 */
    private applyFontSize(): void {
        const content = this.containerEl.querySelector('.bookshelf-reader-content');
        if (content) {
            (content as HTMLElement).style.setProperty('--bookshelf-font-size', `${this.fontSize}px`);
        }
    }

    /** 应用主题 */
    private applyTheme(): void {
        const content = this.containerEl.querySelector('.bookshelf-reader-content');
        if (content) {
            content.removeClass('light', 'dark', 'sepia');
            content.addClass(this.theme);
        }
    }

    /** 滚动到顶部 */
    private scrollToTop(): void {
        const content = this.containerEl.querySelector('.bookshelf-reader-content');
        if (content) {
            content.scrollTop = 0;
        }
    }

    /** 更新阅读进度 */
    private updateProgress(chapter: EpubChapter): void {
        if (!this.currentBook || !this.epubBook) return;

        const totalChapters = this.epubBook.chapters.length;
        const progress = Math.round(((chapter.index + 1) / totalChapters) * 100);

        // 滚动监听
        const content = this.containerEl.querySelector('.bookshelf-reader-content');
        if (content) {
            let scrollTimer: ReturnType<typeof setTimeout>;
            content.addEventListener('scroll', () => {
                clearTimeout(scrollTimer);
                scrollTimer = setTimeout(() => {
                    const scrollProgress = content.scrollTop / (content.scrollHeight - content.clientHeight);
                    const adjustedProgress = Math.round(
                        ((chapter.index + Math.min(scrollProgress, 1)) / totalChapters) * 100
                    );
                    this.plugin.setReadingProgress(
                        this.currentBook!.id,
                        Math.min(100, adjustedProgress),
                        chapter.index
                    );
                }, 1000);
            }, { once: false });
        }

        this.plugin.setReadingProgress(this.currentBook.id, progress, chapter.index);
    }

    /** 获取所有高亮数据 */
    getHighlights(): Highlight[] {
        return [...this.highlights];
    }
}
