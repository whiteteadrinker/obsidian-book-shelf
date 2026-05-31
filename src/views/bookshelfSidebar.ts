import { ItemView, WorkspaceLeaf, Menu, Notice } from 'obsidian';
import type BookShelfPlugin from '../main';
import type { BookMeta, ReadingStatus } from '../types';

export const BOOKSHELF_VIEW_TYPE = 'bookshelf-sidebar-view';

type LayoutMode = 'list' | 'grid';
type FilterStatus = 'all' | ReadingStatus;

const STATUS_LABELS: Record<FilterStatus, string> = {
    all: '全部',
    unread: '未读',
    reading: '在读',
    finished: '已读完',
};

export class BookshelfSidebarView extends ItemView {
    plugin: BookShelfPlugin;
    private searchQuery: string = '';
    private filterStatus: FilterStatus = 'all';
    private layoutMode: LayoutMode = 'list';
    private sortField: 'title' | 'author' | 'dateAdded' | 'recentRead' = 'dateAdded';

    constructor(leaf: WorkspaceLeaf, plugin: BookShelfPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return BOOKSHELF_VIEW_TYPE;
    }

    getDisplayText(): string {
        return '书库列表';
    }

    getIcon(): string {
        return 'book-open';
    }

    async onOpen(): Promise<void> {
        this.render();
    }

    async onClose(): Promise<void> {
        // Cleanup
    }

    /** 重新渲染 */
    render(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('bookshelf-sidebar');

        // 搜索框
        this.renderSearch(container);

        // 布局切换和筛选
        this.renderToolbar(container);

        // 书籍列表
        this.renderBookList(container);
    }

    /** 搜索框 */
    private renderSearch(container: HTMLElement): void {
        const searchDiv = container.createDiv('bookshelf-sidebar-search');
        const input = searchDiv.createEl('input', {
            attr: {
                type: 'text',
                placeholder: '🔍 搜索书名或作者...',
                value: this.searchQuery,
            },
        });
        input.addEventListener('input', (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value;
            this.renderBookList(
                container.querySelector('.bookshelf-sidebar-list')?.parentElement || container
            );
        });
    }

    /** 工具栏 */
    private renderToolbar(container: HTMLElement): void {
        const toolbar = container.createDiv('bookshelf-sidebar-toolbar');

        // 筛选按钮
        const filters = toolbar.createDiv('bookshelf-sidebar-filters');
        const statuses: FilterStatus[] = ['all', 'unread', 'reading', 'finished'];
        for (const status of statuses) {
            const btn = filters.createDiv('bookshelf-filter-btn');
            btn.setText(status === 'all' ? '📚 全部' :
                status === 'unread' ? '📖 未读' :
                status === 'reading' ? '📚 在读' : '✅ 已读');
            if (this.filterStatus === status) {
                btn.addClass('active');
            }
            btn.addEventListener('click', () => {
                this.filterStatus = status;
                this.render();
            });
        }

        // 排序
        const sortGroup = toolbar.createDiv('bookshelf-sidebar-sort');
        sortGroup.style.marginLeft = 'auto';

        const sortSelect = sortGroup.createEl('select');
        const sortOptions: { value: string; label: string }[] = [
            { value: 'dateAdded', label: '📅 最近添加' },
            { value: 'title', label: '🔤 书名' },
            { value: 'author', label: '✍️ 作者' },
            { value: 'recentRead', label: '📖 最近阅读' },
        ];
        for (const opt of sortOptions) {
            const option = sortSelect.createEl('option', {
                text: opt.label,
                attr: { value: opt.value },
            });
            if (this.sortField === opt.value) {
                option.selected = true;
            }
        }
        sortSelect.addEventListener('change', () => {
            this.sortField = sortSelect.value as 'title' | 'author' | 'dateAdded' | 'recentRead';
            this.render();
        });

        // 布局切换
        const layoutToggle = toolbar.createDiv('bookshelf-layout-toggle');
        layoutToggle.style.marginLeft = '8px';

        const listBtn = layoutToggle.createDiv('bookshelf-layout-btn');
        listBtn.setText('☰');
        if (this.layoutMode === 'list') listBtn.addClass('active');
        listBtn.addEventListener('click', () => {
            this.layoutMode = 'list';
            this.render();
        });

        const gridBtn = layoutToggle.createDiv('bookshelf-layout-btn');
        gridBtn.setText('▦');
        if (this.layoutMode === 'grid') gridBtn.addClass('active');
        gridBtn.addEventListener('click', () => {
            this.layoutMode = 'grid';
            this.render();
        });
    }

    /** 书籍列表 */
    private renderBookList(container: HTMLElement): void {
        // 移除旧的列表
        const existing = container.querySelector('.bookshelf-sidebar-list');
        if (existing) existing.remove();

        const listContainer = container.createDiv('bookshelf-sidebar-list');
        listContainer.addClass(this.layoutMode);

        // 过滤和排序
        let books = this.getFilteredBooks();

        // 渲染
        if (books.length === 0) {
            listContainer.createDiv({
                cls: 'bookshelf-empty',
                text: this.searchQuery
                    ? '没有找到匹配的书籍'
                    : '书库为空，使用 "🔍 扫描书籍目录" 命令添加书籍',
            });
            return;
        }

        for (const book of books) {
            this.renderBookCard(listContainer, book);
        }
    }

    /** 获取过滤和排序后的书籍 */
    private getFilteredBooks(): BookMeta[] {
        let books = [...this.plugin.books];

        // 状态筛选
        if (this.filterStatus !== 'all') {
            books = books.filter(b => b.readingStatus === this.filterStatus);
        }

        // 搜索
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            books = books.filter(b =>
                b.title.toLowerCase().includes(query) ||
                b.author.toLowerCase().includes(query) ||
                b.publisher.toLowerCase().includes(query)
            );
        }

        // 排序
        books.sort((a, b) => {
            switch (this.sortField) {
                case 'title':
                    return a.title.localeCompare(b.title);
                case 'author':
                    return a.author.localeCompare(b.author);
                case 'recentRead':
                    // 按阅读状态 + 日期排序（在读优先）
                    const statusOrder: Record<string, number> = { reading: 0, unread: 1, finished: 2 };
                    return (statusOrder[a.readingStatus] - statusOrder[b.readingStatus]) ||
                        new Date(b.dateFinished || b.dateAdded).getTime() -
                        new Date(a.dateFinished || a.dateAdded).getTime();
                case 'dateAdded':
                default:
                    return new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime();
            }
        });

        return books;
    }

    /** 渲染单本书籍卡片 */
    private renderBookCard(container: HTMLElement, book: BookMeta): void {
        const card = container.createDiv('bookshelf-book-card');
        card.setAttribute('data-book-id', book.id);

        // 封面
        const coverDiv = card.createDiv('bookshelf-book-cover');
        if (book.cover) {
            const img = coverDiv.createEl('img', { attr: { src: book.cover } });
            img.onerror = () => {
                coverDiv.setText(book.format === 'pdf' ? '📘' : '📕');
            };
        } else {
            coverDiv.setText(book.format === 'pdf' ? '📘' : '📕');
        }

        // 信息
        const info = card.createDiv('bookshelf-book-info');
        info.createDiv('bookshelf-book-title').setText(book.title);
        info.createDiv('bookshelf-book-author').setText(book.author || '未知作者');

        // 状态标签 + 进度
        const metaRow = info.createDiv('bookshelf-book-meta');

        const statusTag = metaRow.createDiv(`bookshelf-status-tag ${book.readingStatus}`);
        statusTag.setText(
            book.readingStatus === 'unread' ? '未读' :
            book.readingStatus === 'reading' ? '在读' : '已读'
        );

        if (book.rating > 0) {
            metaRow.createDiv('bookshelf-book-rating').setText('⭐'.repeat(book.rating));
        }

        // 进度条
        if (book.readingStatus === 'reading' && book.readingProgress > 0) {
            const progressBar = info.createDiv('bookshelf-progress-bar');
            progressBar.createDiv('bookshelf-progress-fill').style.width = `${book.readingProgress}%`;
        }

        // 右键菜单
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showContextMenu(e as MouseEvent, book);
        });

        // 点击打开阅读器
        card.addEventListener('click', () => {
            if (book.format !== 'manual') {
                this.plugin.openReader(book);
            } else if (book.notePath) {
                this.plugin.app.workspace.openLinkText(book.notePath, '', false);
            }
        });
    }

    /** 右键菜单 */
    private showContextMenu(event: MouseEvent, book: BookMeta): void {
        const menu = new Menu();

        menu.addItem((item) => {
            item.setTitle('📖 标记为未读')
                .onClick(async () => {
                    await this.plugin.setReadingStatus(book.id, 'unread');
                    this.render();
                });
        });
        menu.addItem((item) => {
            item.setTitle('📚 标记为在读')
                .onClick(async () => {
                    await this.plugin.setReadingStatus(book.id, 'reading');
                    this.render();
                });
        });
        menu.addItem((item) => {
            item.setTitle('✅ 标记为已读完')
                .onClick(async () => {
                    await this.plugin.setReadingStatus(book.id, 'finished');
                    this.render();
                });
        });

        menu.addSeparator();

        if (book.notePath) {
            menu.addItem((item) => {
                item.setTitle('📝 打开笔记')
                    .onClick(() => {
                        this.plugin.app.workspace.openLinkText(book.notePath, '', false);
                    });
            });
        }

        if (book.filePath) {
            menu.addItem((item) => {
                item.setTitle('📂 在文件管理器中显示')
                    .onClick(() => {
                        const file = this.plugin.app.vault.getAbstractFileByPath(book.filePath);
                        if (file) {
                            this.plugin.app.workspace.getLeaf().openFile(file as any);
                        }
                    });
            });
        }

        menu.addSeparator();

        menu.addItem((item) => {
            item.setTitle('🗑️ 从书库中移除')
                .onClick(async () => {
                    await this.plugin.removeBook(book.id);
                    this.render();
                    new Notice(`已移除《${book.title}》`);
                });
        });

        menu.showAtMouseEvent(event);
    }
}
