import { ItemView, WorkspaceLeaf, Menu, Modal, Notice } from 'obsidian';
import type BookShelfPlugin from '../main';
import type { BookMeta, BookshelfViewMode, ReadingStatus } from '../types';
import { generateId } from '../utils/fileUtils';

export const DASHBOARD_VIEW_TYPE = 'bookshelf-dashboard-view';

type ViewMode = BookshelfViewMode;
type FilterStatus = 'all' | ReadingStatus;
type SortField = 'dateAdded' | 'title' | 'author';

const STATUS_CONFIG: Record<ReadingStatus, { label: string; icon: string; cssClass: string }> = {
    unread: { label: '未读', icon: '📖', cssClass: 'unread' },
    reading: { label: '在读', icon: '📚', cssClass: 'reading' },
    finished: { label: '已读完', icon: '✅', cssClass: 'finished' },
};

export class DashboardView extends ItemView {
    plugin: BookShelfPlugin;
    private viewMode: ViewMode = 'kanban';
    private filterStatus: FilterStatus = 'all';
    private sortField: SortField = 'dateAdded';
    private searchQuery: string = '';

    constructor(leaf: WorkspaceLeaf, plugin: BookShelfPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.viewMode = plugin.settings.defaultViewMode;
    }

    getViewType(): string { return DASHBOARD_VIEW_TYPE; }
    getDisplayText(): string { return '书库'; }
    getIcon(): string { return 'library'; }

    async onOpen(): Promise<void> { this.render(); }

    render(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('bookshelf-dashboard');

        this.renderHeader(container);
        this.renderToolbar(container);

        if (this.viewMode === 'kanban') {
            this.renderKanban(container);
        } else {
            this.renderBookList(container);
        }
    }

    // ===== Header =====

    private renderHeader(container: HTMLElement): void {
        const header = container.createDiv('bookshelf-dashboard-header');
        header.createEl('h2', { text: '📚 我的书库' });

        const books = this.plugin.books;
        const total = books.length;
        const unread = books.filter(b => b.readingStatus === 'unread').length;
        const reading = books.filter(b => b.readingStatus === 'reading').length;
        const finished = books.filter(b => b.readingStatus === 'finished').length;

        const stats = header.createDiv('bookshelf-stats');
        stats.createDiv('bookshelf-stat').innerHTML = `<span class="count">${total}</span> 总藏书`;
        stats.createDiv('bookshelf-stat').innerHTML = `<span class="count">${unread}</span> 📖 未读`;
        stats.createDiv('bookshelf-stat').innerHTML = `<span class="count">${reading}</span> 📚 在读`;
        stats.createDiv('bookshelf-stat').innerHTML = `<span class="count">${finished}</span> ✅ 已读`;

        const actions = header.createDiv();
        actions.style.marginTop = '10px';

        const scanBtn = actions.createEl('button', { text: '🔍 扫描书籍', cls: 'mod-cta' });
        scanBtn.style.marginRight = '8px';
        scanBtn.addEventListener('click', async () => {
            await this.plugin.scanBooks();
            this.render();
        });

        const addBtn = actions.createEl('button', { text: '➕ 手动添加' });
        addBtn.addEventListener('click', () => {
            new ManualAddBookModal(this.plugin.app, this.plugin, () => this.render()).open();
        });
    }

    // ===== Toolbar =====

    private renderToolbar(container: HTMLElement): void {
        const toolbar = container.createDiv();
        toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap;';

        // 视图模式切换
        const modeGroup = toolbar.createDiv();
        modeGroup.style.cssText = 'display:flex;gap:2px;';
        const modes: { mode: ViewMode; label: string }[] = [
            { mode: 'kanban', label: '📋 看板' },
            { mode: 'list', label: '📋 列表' },
            { mode: 'grid', label: '▦ 网格' },
        ];
        for (const { mode, label } of modes) {
            const btn = modeGroup.createEl('button', { text: label });
            btn.style.cssText = 'padding:4px 10px;font-size:12px;border-radius:4px;cursor:pointer;';
            if (this.viewMode === mode) {
                btn.style.background = 'var(--text-accent)';
                btn.style.color = 'white';
                btn.style.border = '1px solid var(--text-accent)';
            }
            btn.addEventListener('click', () => { this.viewMode = mode; this.render(); });
        }

        // 搜索
        const searchInput = toolbar.createEl('input', {
            attr: { type: 'text', placeholder: '🔍 搜索...', value: this.searchQuery },
        });
        searchInput.style.cssText = 'flex:1;min-width:120px;padding:4px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);font-size:13px;';
        searchInput.addEventListener('input', () => {
            this.searchQuery = (searchInput.value || '').trim();
            this.render();
        });

        // 筛选
        const filterSel = toolbar.createEl('select');
        filterSel.style.cssText = 'padding:4px 8px;font-size:12px;border-radius:4px;';
        const filterOpts: { value: FilterStatus; label: string }[] = [
            { value: 'all', label: '📚 全部' },
            { value: 'unread', label: '📖 未读' },
            { value: 'reading', label: '📚 在读' },
            { value: 'finished', label: '✅ 已读' },
        ];
        for (const opt of filterOpts) {
            const o = filterSel.createEl('option', { text: opt.label, attr: { value: opt.value } });
            if (this.filterStatus === opt.value) o.selected = true;
        }
        filterSel.addEventListener('change', () => {
            this.filterStatus = filterSel.value as FilterStatus;
            this.render();
        });

        // 排序
        const sortSel = toolbar.createEl('select');
        sortSel.style.cssText = 'padding:4px 8px;font-size:12px;border-radius:4px;';
        const sortOpts: { value: SortField; label: string }[] = [
            { value: 'dateAdded', label: '📅 最近添加' },
            { value: 'title', label: '🔤 书名' },
            { value: 'author', label: '✍️ 作者' },
        ];
        for (const opt of sortOpts) {
            const o = sortSel.createEl('option', { text: opt.label, attr: { value: opt.value } });
            if (this.sortField === opt.value) o.selected = true;
        }
        sortSel.addEventListener('change', () => {
            this.sortField = sortSel.value as SortField;
            this.render();
        });
    }

    // ===== Kanban =====

    private renderKanban(container: HTMLElement): void {
        const kanban = container.createDiv('bookshelf-kanban');
        const statuses: ReadingStatus[] = ['unread', 'reading', 'finished'];

        for (const status of statuses) {
            const config = STATUS_CONFIG[status];
            const column = kanban.createDiv('bookshelf-column');
            column.setAttribute('data-status', status);

            const colHeader = column.createDiv('bookshelf-column-header');
            colHeader.createEl('h3', { text: `${config.icon} ${config.label}` });
            const count = this.plugin.books.filter(b => b.readingStatus === status).length;
            colHeader.createDiv('bookshelf-column-count').setText(String(count));

            const body = column.createDiv('bookshelf-column-body');
            this.setupDragDrop(body, status);

            const columnBooks = this.plugin.books.filter(b => b.readingStatus === status);
            for (const book of columnBooks) {
                this.renderBookCard(body, book);
            }
        }
    }

    // ===== List / Grid =====

    private renderBookList(container: HTMLElement): void {
        const listContainer = container.createDiv('bookshelf-sidebar-list');
        listContainer.addClass(this.viewMode === 'grid' ? 'grid' : '');

        const books = this.getFilteredBooks();

        if (books.length === 0) {
            listContainer.createDiv({
                text: this.searchQuery ? '没有找到匹配的书籍' : '书库为空，点击"扫描书籍"或"手动添加"',
                attr: { style: 'padding:40px;text-align:center;color:var(--text-muted);' },
            });
            return;
        }

        for (const book of books) {
            this.renderBookCard(listContainer, book);
        }
    }

    // ===== Book Card =====

    private renderBookCard(container: HTMLElement, book: BookMeta): void {
        const card = container.createDiv('bookshelf-book-card');
        card.setAttribute('data-book-id', book.id);
        card.draggable = this.viewMode === 'kanban';

        // Drag
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer?.setData('text/plain', book.id);
            card.addClass('dragging');
        });
        card.addEventListener('dragend', () => card.removeClass('dragging'));

        // Cover
        const coverDiv = card.createDiv('bookshelf-book-cover');
        if (book.cover) {
            const img = coverDiv.createEl('img', { attr: { src: book.cover } });
            img.onerror = () => { coverDiv.setText(book.format === 'pdf' ? '📘' : '📕'); };
        } else {
            coverDiv.setText(book.format === 'pdf' ? '📘' : book.format === 'manual' ? '📝' : '📕');
        }

        // Info
        const info = card.createDiv('bookshelf-book-info');
        info.createDiv('bookshelf-book-title').setText(book.title);
        info.createDiv('bookshelf-book-author').setText(book.author || '未知作者');

        // Status tag + rating
        const meta = info.createDiv('bookshelf-book-meta');
        const tag = meta.createDiv(`bookshelf-status-tag ${book.readingStatus}`);
        tag.setText(STATUS_CONFIG[book.readingStatus]?.label || book.readingStatus);
        if (book.rating > 0) {
            meta.createDiv().setText('⭐'.repeat(book.rating));
        }

        // Progress
        if (book.readingStatus === 'reading' && book.readingProgress > 0) {
            const bar = info.createDiv('bookshelf-progress-bar');
            bar.createDiv('bookshelf-progress-fill').style.width = `${book.readingProgress}%`;
        }

        // Context menu
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showContextMenu(e as MouseEvent, book);
        });

        // Click → open reader
        card.addEventListener('click', async (e) => {
            if (e.button !== 0) return;
            if (book.readingStatus === 'unread') {
                await this.plugin.setReadingStatus(book.id, 'reading');
            }
            if (book.format !== 'manual' && book.filePath) {
                this.plugin.openReader(book);
            } else {
                const notePath = await this.plugin.ensureBookHasNote(book.id);
                if (notePath) {
                    this.plugin.app.workspace.openLinkText(notePath, '', false);
                    this.render();
                }
            }
        });
    }

    // ===== Drag & Drop =====

    private setupDragDrop(body: HTMLElement, targetStatus: ReadingStatus): void {
        body.addEventListener('dragover', (e) => { e.preventDefault(); body.addClass('drag-over'); });
        body.addEventListener('dragleave', () => body.removeClass('drag-over'));
        body.addEventListener('drop', async (e) => {
            e.preventDefault();
            body.removeClass('drag-over');
            const bookId = e.dataTransfer?.getData('text/plain');
            if (bookId) {
                const book = this.plugin.getBook(bookId);
                if (book && book.readingStatus !== targetStatus) {
                    await this.plugin.setReadingStatus(bookId, targetStatus);
                    this.render();
                }
            }
        });
    }

    // ===== Filter/Sort =====

    private getFilteredBooks(): BookMeta[] {
        let books = [...this.plugin.books];

        if (this.filterStatus !== 'all') {
            books = books.filter(b => b.readingStatus === this.filterStatus);
        }
        if (this.searchQuery) {
            const q = this.searchQuery.toLowerCase();
            books = books.filter(b =>
                b.title.toLowerCase().includes(q) ||
                b.author.toLowerCase().includes(q) ||
                b.publisher.toLowerCase().includes(q)
            );
        }
        books.sort((a, b) => {
            switch (this.sortField) {
                case 'title': return a.title.localeCompare(b.title);
                case 'author': return a.author.localeCompare(b.author);
                default: return new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime();
            }
        });
        return books;
    }

    // ===== Context Menu =====

    private showContextMenu(event: MouseEvent, book: BookMeta): void {
        const menu = new Menu();

        menu.addItem(item => item.setTitle('📖 标记为未读').onClick(async () => {
            await this.plugin.setReadingStatus(book.id, 'unread');
            this.render();
        }));
        menu.addItem(item => item.setTitle('📚 标记为在读').onClick(async () => {
            await this.plugin.setReadingStatus(book.id, 'reading');
            this.render();
        }));
        menu.addItem(item => item.setTitle('✅ 标记为已读完').onClick(async () => {
            await this.plugin.setReadingStatus(book.id, 'finished');
            this.render();
        }));

        menu.addSeparator();

        if (book.notePath) {
            menu.addItem(item => item.setTitle('📝 打开笔记').onClick(() => {
                this.plugin.app.workspace.openLinkText(book.notePath, '', false);
            }));
        }
        if (book.format !== 'manual' && book.filePath) {
            menu.addItem(item => item.setTitle('📖 打开阅读器').onClick(() => {
                this.plugin.openReader(book);
            }));
        }
        if (book.filePath) {
            menu.addItem(item => item.setTitle('📂 定位文件').onClick(() => {
                const file = this.plugin.app.vault.getAbstractFileByPath(book.filePath);
                if (file) this.plugin.app.workspace.getLeaf().openFile(file as any);
            }));
        }

        menu.addSeparator();
        menu.addItem(item => item.setTitle('🗑️ 从书库移除').onClick(async () => {
            await this.plugin.removeBook(book.id);
            this.render();
            new Notice(`已移除《${book.title}》`);
        }));

        menu.showAtMouseEvent(event);
    }
}

// ===== Manual Add Modal =====

export class ManualAddBookModal extends Modal {
    plugin: BookShelfPlugin;
    onComplete: () => void;

    constructor(app: any, plugin: BookShelfPlugin, onComplete: () => void) {
        super(app);
        this.plugin = plugin;
        this.onComplete = onComplete;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '➕ 手动添加书籍' });

        const form = contentEl.createDiv('bookshelf-manual-add-form');

        const titleInput = this.field(form, '书名 *', 'text', '请输入书名');
        const authorInput = this.field(form, '作者', 'text', '请输入作者');
        const publisherInput = this.field(form, '出版社', 'text', '请输入出版社');
        const isbnInput = this.field(form, 'ISBN', 'text', '请输入 ISBN（可选）');
        const dateInput = this.field(form, '出版日期', 'text', '如 2024-01-01（可选）');

        const descGroup = form.createDiv();
        descGroup.createEl('label', { text: '简介' });
        const descInput = descGroup.createEl('textarea', { attr: { placeholder: '书籍简介（可选）', rows: '3' } });

        const statusGroup = form.createDiv();
        statusGroup.createEl('label', { text: '初始状态' });
        const statusSelect = statusGroup.createEl('select');
        statusSelect.createEl('option', { text: '📖 未读', attr: { value: 'unread' } });
        statusSelect.createEl('option', { text: '📚 在读', attr: { value: 'reading' } });
        statusSelect.createEl('option', { text: '✅ 已读完', attr: { value: 'finished' } });

        const btnGroup = form.createDiv();
        btnGroup.style.cssText = 'margin-top:16px;display:flex;gap:8px;';

        btnGroup.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
        btnGroup.createEl('button', { text: '添加', cls: 'mod-cta' }).addEventListener('click', async () => {
            const title = titleInput.value.trim();
            if (!title) { new Notice('请输入书名'); return; }

            const book: BookMeta = {
                id: generateId(),
                title,
                author: authorInput.value.trim(),
                publisher: publisherInput.value.trim(),
                isbn: isbnInput.value.trim(),
                publishDate: dateInput.value.trim(),
                description: descInput.value.trim(),
                cover: '',
                format: 'manual',
                filePath: '',
                readingStatus: statusSelect.value as ReadingStatus,
                readingProgress: statusSelect.value === 'finished' ? 100 : 0,
                currentPosition: 0,
                dateAdded: new Date().toISOString(),
                dateFinished: statusSelect.value === 'finished' ? new Date().toISOString() : '',
                rating: 0,
                tags: [],
                notePath: '',
            };

            await this.plugin.addBook(book);
            const notePath = await this.plugin.ensureBookHasNote(book.id);
            if (notePath) {
                await this.plugin.updateBook(book.id, { notePath });
            }
            new Notice(`已添加《${book.title}》`);
            this.close();
            this.onComplete();
        });
    }

    private field(form: HTMLElement, label: string, type: string, placeholder: string): HTMLInputElement {
        const group = form.createDiv();
        group.createEl('label', { text: label });
        return group.createEl('input', { attr: { type, placeholder } });
    }

    onClose(): void { this.contentEl.empty(); }
}
