import { Plugin, Notice } from 'obsidian';
import { BookShelfSettingTab } from './settings';
import { DEFAULT_SETTINGS } from './types';
import type { BookShelfSettings, BookShelfPluginData, BookMeta } from './types';
import { scanAndImport } from './scanner/bookScanner';
import { lookupBookOnline } from './metadata/onlineLookup';

import { DashboardView, DASHBOARD_VIEW_TYPE, ManualAddBookModal } from './views/dashboardView';
import { BookshelfSidebarView, BOOKSHELF_VIEW_TYPE } from './views/bookshelfSidebar';
import { ReaderPanelView, READER_VIEW_TYPE } from './views/readerPanel';
import { createBookNote, ensureBookNote } from './notes/noteManager';

export default class BookShelfPlugin extends Plugin {
    settings!: BookShelfSettings;
    books: BookMeta[] = [];

    async onload(): Promise<void> {
        console.log('📚 BookShelf plugin loading...');

        // 加载数据
        const data = await this.loadData() as BookShelfPluginData | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
        this.books = data?.books ?? [];

        // 注册设置页
        this.addSettingTab(new BookShelfSettingTab(this.app, this));

        // 注册视图
        this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
        this.registerView(BOOKSHELF_VIEW_TYPE, (leaf) => new BookshelfSidebarView(leaf, this));
        this.registerView(READER_VIEW_TYPE, (leaf) => new ReaderPanelView(leaf, this));

        // 注册命令
        this.registerCommands();

        // 启动时自动扫描
        if (this.settings.autoScanOnStartup) {
            await this.scanBooks();
        }

        console.log('📚 BookShelf plugin loaded!');
    }

    onunload(): void {
        console.log('📚 BookShelf plugin unloading...');
    }

    // === 持久化 ===

    async saveSettings(): Promise<void> {
        await this.savePluginData();
    }

    async savePluginData(): Promise<void> {
        const data: BookShelfPluginData = {
            settings: this.settings,
            books: this.books,
        };
        await super.saveData(data);
    }

    // === 书籍管理方法 ===

    /** 根据 ID 获取书籍 */
    getBook(id: string): BookMeta | undefined {
        return this.books.find(b => b.id === id);
    }

    /** 添加书籍 */
    async addBook(book: BookMeta): Promise<void> {
        this.books.push(book);
        await this.savePluginData();
    }

    /** 更新书籍 */
    async updateBook(id: string, updates: Partial<BookMeta>): Promise<void> {
        const book = this.getBook(id);
        if (book) {
            Object.assign(book, updates);
            await this.savePluginData();
        }
    }

    /** 删除书籍 */
    async removeBook(id: string): Promise<void> {
        this.books = this.books.filter(b => b.id !== id);
        await this.savePluginData();
    }

    /** 更新阅读状态 */
    async setReadingStatus(id: string, status: BookMeta['readingStatus']): Promise<void> {
        const updates: Partial<BookMeta> = { readingStatus: status };
        if (status === 'finished') {
            updates.dateFinished = new Date().toISOString();
            updates.readingProgress = 100;
        }
        await this.updateBook(id, updates);
    }

    /** 更新阅读进度 */
    async setReadingProgress(id: string, progress: number, position: number): Promise<void> {
        const book = this.getBook(id);
        const updates: Partial<BookMeta> = {
            readingProgress: Math.min(100, Math.max(0, progress)),
            currentPosition: position,
        };
        // 如果从未读切换到开始阅读，自动标记为在读
        if (book && book.readingStatus === 'unread' && progress > 0) {
            updates.readingStatus = 'reading';
        }
        // 如果读完了
        if (progress >= 100 && book?.readingStatus !== 'finished') {
            updates.readingStatus = 'finished';
            updates.dateFinished = new Date().toISOString();
        }
        await this.updateBook(id, updates);
    }

    // === 视图激活 ===

    /** 激活或打开指定类型的视图 */
    async activateView(viewType: string): Promise<void> {
        const { workspace } = this.app;

        // 查找已有的视图
        const existing = workspace.getLeavesOfType(viewType);
        if (existing.length > 0) {
            workspace.revealLeaf(existing[0]);
            return;
        }

        // 创建新叶子并打开视图
        const leaf = workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: viewType, active: true });
            workspace.revealLeaf(leaf);
        }
    }

    /** 打开书籍阅读器 */
    async openReader(book: BookMeta): Promise<void> {
        const { workspace } = this.app;

        // 查找已有的阅读器视图
        const existing = workspace.getLeavesOfType(READER_VIEW_TYPE);
        if (existing.length > 0) {
            const view = existing[0].view as ReaderPanelView;
            await view.loadBook(book);
            workspace.revealLeaf(existing[0]);
            return;
        }

        // 创建新的阅读器视图
        const leaf = workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: READER_VIEW_TYPE, active: true });
            const view = leaf.view as ReaderPanelView;
            await view.loadBook(book);
            workspace.revealLeaf(leaf);
        }
    }

    // === 扫描书籍 ===

    /** 扫描书籍目录，导入新发现的书籍 */
    async scanBooks(): Promise<void> {
        const newBooks = await scanAndImport(this.app.vault, this.settings, this.books);
        if (newBooks.length > 0) {
            for (const book of newBooks) {
                await this.addBook(book);
            }
            new Notice(`📚 发现了 ${newBooks.length} 本新书！`);

            // 在线查询补全元数据
            if (this.settings.enableOnlineLookup) {
                for (const book of newBooks) {
                    try {
                        const onlineData = await lookupBookOnline(book, this.settings.lookupTimeout);
                        if (Object.keys(onlineData).length > 0) {
                            await this.updateBook(book.id, onlineData);
                        }
                    } catch {
                        // 单本查询失败不影响整体
                    }
                }
            }

            // 为新书创建笔记文件
            for (const book of newBooks) {
                try {
                    const notePath = await createBookNote(this.app.vault, book, this.settings);
                    if (notePath) {
                        await this.updateBook(book.id, { notePath });
                    }
                } catch {
                    // 笔记创建失败不影响书籍入库
                }
            }
        } else {
            new Notice('📚 没有发现新书籍');
        }
    }

    // === 命令注册 ===

    private registerCommands(): void {
        // 打开仪表盘
        this.addCommand({
            id: 'open-dashboard',
            name: '📊 打开书库仪表盘',
            callback: () => {
                this.activateView(DASHBOARD_VIEW_TYPE);
            },
        });

        // 打开书库侧边栏
        this.addCommand({
            id: 'open-bookshelf',
            name: '📚 打开书库列表',
            callback: () => {
                this.activateView(BOOKSHELF_VIEW_TYPE);
            },
        });

        // 扫描书籍
        this.addCommand({
            id: 'scan-books',
            name: '🔍 扫描书籍目录',
            callback: async () => {
                await this.scanBooks();
            },
        });

        // 手动添加书籍
        this.addCommand({
            id: 'add-book-manually',
            name: '➕ 手动添加书籍',
            callback: () => {
                new ManualAddBookModal(this.app, this, () => {
                    // 刷新仪表盘视图
                    const leaves = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);
                    for (const leaf of leaves) {
                        const view = leaf.view as DashboardView;
                        view.render();
                    }
                }).open();
            },
        });
    }
}
