import { ItemView, WorkspaceLeaf, Menu, Modal, Setting, Notice } from 'obsidian';
import type BookShelfPlugin from '../main';
import type { BookMeta, ReadingStatus } from '../types';
import { generateId } from '../utils/fileUtils';

export const DASHBOARD_VIEW_TYPE = 'bookshelf-dashboard-view';

const STATUS_CONFIG: Record<ReadingStatus, { label: string; icon: string; cssClass: string }> = {
    unread: { label: '未读', icon: '📖', cssClass: 'unread' },
    reading: { label: '在读', icon: '📚', cssClass: 'reading' },
    finished: { label: '已读完', icon: '✅', cssClass: 'finished' },
};

export class DashboardView extends ItemView {
    plugin: BookShelfPlugin;

    constructor(leaf: WorkspaceLeaf, plugin: BookShelfPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return DASHBOARD_VIEW_TYPE;
    }

    getDisplayText(): string {
        return '书库仪表盘';
    }

    getIcon(): string {
        return 'library';
    }

    async onOpen(): Promise<void> {
        this.render();
    }

    async onClose(): Promise<void> {
        // Cleanup
    }

    /** 重新渲染整个仪表盘 */
    render(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('bookshelf-dashboard');

        // 头部统计
        this.renderHeader(container);

        // 三栏看板
        this.renderKanban(container);
    }

    /** 渲染头部统计 */
    private renderHeader(container: HTMLElement): void {
        const header = container.createDiv('bookshelf-dashboard-header');
        header.createEl('h2', { text: '📊 我的书库' });

        const books = this.plugin.books;
        const counts = {
            total: books.length,
            unread: books.filter(b => b.readingStatus === 'unread').length,
            reading: books.filter(b => b.readingStatus === 'reading').length,
            finished: books.filter(b => b.readingStatus === 'finished').length,
        };

        const stats = header.createDiv('bookshelf-stats');
        stats.createDiv('bookshelf-stat').innerHTML =
            `<span class="count">${counts.total}</span> 总藏书`;
        stats.createDiv('bookshelf-stat').innerHTML =
            `<span class="count">${counts.unread}</span> 📖 未读`;
        stats.createDiv('bookshelf-stat').innerHTML =
            `<span class="count">${counts.reading}</span> 📚 在读`;
        stats.createDiv('bookshelf-stat').innerHTML =
            `<span class="count">${counts.finished}</span> ✅ 已读`;

        // 操作按钮
        const actions = header.createDiv('bookshelf-actions');
        actions.style.marginTop = '12px';

        const scanBtn = actions.createEl('button', {
            text: '🔍 扫描书籍',
            cls: 'mod-cta',
        });
        scanBtn.style.marginRight = '8px';
        scanBtn.addEventListener('click', async () => {
            await this.plugin.scanBooks();
            this.render();
        });

        const addBtn = actions.createEl('button', {
            text: '➕ 手动添加',
        });
        addBtn.addEventListener('click', () => {
            new ManualAddBookModal(this.plugin.app, this.plugin, () => this.render()).open();
        });
    }

    /** 渲染三栏看板 */
    private renderKanban(container: HTMLElement): void {
        const kanban = container.createDiv('bookshelf-kanban');
        const statuses: ReadingStatus[] = ['unread', 'reading', 'finished'];

        for (const status of statuses) {
            const config = STATUS_CONFIG[status];
            const column = kanban.createDiv('bookshelf-column');
            column.setAttribute('data-status', status);

            // 列头
            const colHeader = column.createDiv('bookshelf-column-header');
            colHeader.createEl('h3', { text: `${config.icon} ${config.label}` });
            const booksInColumn = this.plugin.books.filter(b => b.readingStatus === status);
            colHeader.createDiv('bookshelf-column-count').setText(String(booksInColumn.length));

            // 列内容（拖放区域）
            const body = column.createDiv('bookshelf-column-body');
            this.setupDragDrop(body, status);

            // 渲染书籍卡片
            for (const book of booksInColumn) {
                this.renderBookCard(body, book);
            }
        }
    }

    /** 渲染单本书籍卡片 */
    private renderBookCard(container: HTMLElement, book: BookMeta): void {
        const card = container.createDiv('bookshelf-book-card');
        card.setAttribute('data-book-id', book.id);
        card.draggable = true;

        // 拖拽事件
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer?.setData('text/plain', book.id);
            card.addClass('dragging');
        });
        card.addEventListener('dragend', () => {
            card.removeClass('dragging');
        });

        // 封面
        const coverDiv = card.createDiv('bookshelf-book-cover');
        if (book.cover) {
            const img = coverDiv.createEl('img', { attr: { src: book.cover } });
            img.onerror = () => {
                coverDiv.setText(book.format === 'epub' ? '📕' : '📘');
            };
        } else {
            coverDiv.setText(book.format === 'epub' ? '📕' : '📘');
        }

        // 信息
        const info = card.createDiv('bookshelf-book-info');
        info.createDiv('bookshelf-book-title').setText(book.title);
        info.createDiv('bookshelf-book-author').setText(book.author || '未知作者');

        // 元信息标签
        const meta = info.createDiv('bookshelf-book-meta');
        if (book.format === 'manual') {
            meta.createDiv('bookshelf-status-tag manual').setText('手动');
        }

        // 进度条（仅对在读的书籍显示）
        if (book.readingStatus === 'reading' && book.readingProgress > 0) {
            const progressBar = info.createDiv('bookshelf-progress-bar');
            progressBar.createDiv('bookshelf-progress-fill').style.width = `${book.readingProgress}%`;
        }

        // 右键菜单
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showBookContextMenu(e as MouseEvent, book);
        });

        // 点击打开阅读器
        card.addEventListener('click', (e) => {
            if (e.button === 0) {
                if (book.readingStatus === 'unread') {
                    this.plugin.setReadingStatus(book.id, 'reading');
                    this.render();
                }
                if (book.format !== 'manual') {
                    this.plugin.openReader(book);
                } else if (book.notePath) {
                    this.plugin.app.workspace.openLinkText(book.notePath, '', false);
                }
            }
        });
    }

    /** 设置拖放区域 */
    private setupDragDrop(body: HTMLElement, targetStatus: ReadingStatus): void {
        body.addEventListener('dragover', (e) => {
            e.preventDefault();
            body.addClass('drag-over');
        });

        body.addEventListener('dragleave', () => {
            body.removeClass('drag-over');
        });

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

    /** 右键菜单 */
    private showBookContextMenu(event: MouseEvent, book: BookMeta): void {
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
                            // 在 Obsidian 文件列表中定位
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

// ===== 手动添加书籍的 Modal =====

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

        // 书名
        const titleInput = this.createField(form, '书名 *', 'text', '请输入书名');

        // 作者
        const authorInput = this.createField(form, '作者', 'text', '请输入作者');

        // 出版社
        const publisherInput = this.createField(form, '出版社', 'text', '请输入出版社');

        // ISBN
        const isbnInput = this.createField(form, 'ISBN', 'text', '请输入 ISBN（可选）');

        // 出版日期
        const dateInput = this.createField(form, '出版日期', 'text', '如 2024-01-01（可选）');

        // 描述
        const descGroup = form.createDiv();
        descGroup.createEl('label', { text: '简介' });
        const descInput = descGroup.createEl('textarea', {
            attr: { placeholder: '书籍简介（可选）', rows: '3' },
        });

        // 初始阅读状态
        const statusGroup = form.createDiv();
        statusGroup.createEl('label', { text: '初始状态' });
        const statusSelect = statusGroup.createEl('select');
        statusSelect.createEl('option', { text: '📖 未读', attr: { value: 'unread' } });
        statusSelect.createEl('option', { text: '📚 在读', attr: { value: 'reading' } });
        statusSelect.createEl('option', { text: '✅ 已读完', attr: { value: 'finished' } });

        // 按钮
        const btnGroup = form.createDiv();
        btnGroup.style.marginTop = '16px';
        btnGroup.style.display = 'flex';
        btnGroup.style.gap = '8px';

        const cancelBtn = btnGroup.createEl('button', { text: '取消' });
        cancelBtn.addEventListener('click', () => this.close());

        const saveBtn = btnGroup.createEl('button', {
            text: '添加',
            cls: 'mod-cta',
        });
        saveBtn.addEventListener('click', async () => {
            const title = titleInput.value.trim();
            if (!title) {
                new Notice('请输入书名');
                return;
            }

            const book: BookMeta = {
                id: generateId(),
                title: title,
                author: authorInput.value.trim(),
                publisher: publisherInput.value.trim(),
                isbn: isbnInput.value.trim(),
                publishDate: dateInput.value.trim(),
                description: descInput.value.trim(),
                cover: '',
                format: 'manual',
                filePath: '',
                readingStatus: statusSelect.value as ReadingStatus,
                readingProgress: 0,
                currentPosition: 0,
                dateAdded: new Date().toISOString(),
                dateFinished: statusSelect.value === 'finished' ? new Date().toISOString() : '',
                rating: 0,
                tags: [],
                notePath: '',
            };

            await this.plugin.addBook(book);
            new Notice(`已添加《${book.title}》`);
            this.close();
            this.onComplete();
        });
    }

    private createField(
        form: HTMLElement,
        label: string,
        type: string,
        placeholder: string
    ): HTMLInputElement {
        const group = form.createDiv();
        group.createEl('label', { text: label });
        const input = group.createEl('input', {
            attr: { type, placeholder },
        });
        return input;
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
