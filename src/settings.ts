import { App, PluginSettingTab, Setting } from 'obsidian';
import type BookShelfPlugin from './main';
import type { BookShelfSettings, BookshelfViewMode } from './types';

export class BookShelfSettingTab extends PluginSettingTab {
    plugin: BookShelfPlugin;

    constructor(app: App, plugin: BookShelfPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: '📚 BookShelf Reader 设置' });

        // === 书籍扫描 ===
        containerEl.createEl('h3', { text: '📂 书籍扫描' });

        new Setting(containerEl)
            .setName('扫描目录')
            .setDesc('存放书籍文件的目录（相对于 vault 根目录，多个目录用逗号分隔）')
            .addText(text => text
                .setPlaceholder('books')
                .setValue(this.plugin.settings.scanDirectories.join(','))
                .onChange(async (value) => {
                    this.plugin.settings.scanDirectories = value
                        .split(',')
                        .map(d => d.trim())
                        .filter(d => d.length > 0);
                    if (this.plugin.settings.scanDirectories.length === 0) {
                        this.plugin.settings.scanDirectories = ['books'];
                    }
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('启动时自动扫描')
            .setDesc('每次打开 Obsidian 时自动扫描新书籍')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoScanOnStartup)
                .onChange(async (value) => {
                    this.plugin.settings.autoScanOnStartup = value;
                    await this.plugin.saveSettings();
                }));

        // === 在线查询 ===
        containerEl.createEl('h3', { text: '🌐 在线元数据查询' });

        new Setting(containerEl)
            .setName('启用在线查询')
            .setDesc('使用 Open Library API 补全书籍信息（免费，无需 API key）')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableOnlineLookup)
                .onChange(async (value) => {
                    this.plugin.settings.enableOnlineLookup = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('查询超时')
            .setDesc('在线查询的超时时间（毫秒）')
            .addSlider(slider => slider
                .setLimits(3000, 30000, 1000)
                .setValue(this.plugin.settings.lookupTimeout)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.lookupTimeout = value;
                    await this.plugin.saveSettings();
                }));

        // === 笔记设置 ===
        containerEl.createEl('h3', { text: '📝 笔记设置' });

        new Setting(containerEl)
            .setName('笔记目录')
            .setDesc('书籍笔记存放的目录（相对于 vault 根目录）')
            .addText(text => text
                .setPlaceholder('book-notes')
                .setValue(this.plugin.settings.notesDirectory)
                .onChange(async (value) => {
                    this.plugin.settings.notesDirectory = value.trim() || 'book-notes';
                    await this.plugin.saveSettings();
                }));

        // === 阅读器设置 ===
        containerEl.createEl('h3', { text: '📖 阅读器设置' });

        new Setting(containerEl)
            .setName('默认字体大小')
            .setDesc('EPUB 阅读器的默认字体大小')
            .addSlider(slider => slider
                .setLimits(12, 24, 1)
                .setValue(this.plugin.settings.epubFontSize)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.epubFontSize = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('默认主题')
            .setDesc('EPUB 阅读器的默认主题')
            .addDropdown(dropdown => dropdown
                .addOption('light', '☀️ 日间')
                .addOption('dark', '🌙 夜间')
                .addOption('sepia', '📜 护眼')
                .setValue(this.plugin.settings.epubTheme)
                .onChange(async (value) => {
                    this.plugin.settings.epubTheme = value as BookShelfSettings['epubTheme'];
                    await this.plugin.saveSettings();
                }));

        // === 书库视图 ===
        containerEl.createEl('h3', { text: '🏠 书库视图' });

        new Setting(containerEl)
            .setName('默认书库视图')
            .setDesc('打开书库时默认使用的显示方式')
            .addDropdown(dropdown => dropdown
                .addOption('kanban', '📋 看板')
                .addOption('list', '📋 列表')
                .addOption('grid', '▦ 网格')
                .setValue(this.plugin.settings.defaultViewMode)
                .onChange(async (value) => {
                    this.plugin.settings.defaultViewMode = value as BookshelfViewMode;
                    await this.plugin.saveSettings();
                }));
    }
}
