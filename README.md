# BookShelf Reader

BookShelf Reader is a desktop-only Obsidian plugin for managing a personal EPUB/PDF library, tracking reading progress, and syncing excerpts and notes into Markdown book notes.

## Features

- Scan one or more vault folders for EPUB and PDF files.
- Extract local metadata such as title, author, publisher, ISBN, description, and cover where available.
- Optionally enrich missing metadata through Open Library.
- Manage books in a unified library view with kanban, list, and grid modes.
- Track reading status: unread, reading, and finished.
- Read EPUB files by chapter with table of contents, font size controls, and light/dark/sepia themes.
- Read PDF files with page navigation, zoom controls, and saved progress.
- Save selected text as an excerpt, or add a note to the selected text, and sync it to the book note.
- Automatically create Markdown notes for scanned and manually added books.

## Current Limits

- Excerpts and notes are saved to book notes, but the first community release does not replay persistent highlights inside EPUB/PDF content.
- The plugin is desktop-only.
- PDF rendering runs without an external CDN worker so the plugin can work offline, but very large PDFs may render more slowly.

## Installation

### Community Plugins

After the plugin is accepted into the Obsidian Community Plugins directory:

1. Open Obsidian Settings.
2. Go to Community plugins.
3. Search for `BookShelf Reader`.
4. Install and enable the plugin.

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release.
2. Create this folder in your vault:

```text
.obsidian/plugins/bookshelf-reader/
```

3. Place the three downloaded files in that folder.
4. Restart Obsidian and enable BookShelf Reader in Community plugins.

## Usage

1. Open the BookShelf Reader settings.
2. Set the scan directories, for example `books`.
3. Put EPUB or PDF files in those folders.
4. Run `Scan book folders` from the command palette, or use the scan button in the library view.
5. Open `BookShelf Reader: Open library` from the command palette.
6. Click a book card to open the reader, or right-click it for status and note actions.
7. In the reader, select text and click `摘录` to save an excerpt or `批注` to save an excerpt with a note.

## Development

Install dependencies and build:

```bash
npm install
npm run build
```

For development mode:

```bash
npm run dev
```

For local Obsidian testing, the plugin folder should match the manifest ID:

```text
.obsidian/plugins/bookshelf-reader/
```

## Release

The plugin uses tag-based GitHub Actions releases.

1. Update `manifest.json`, `package.json`, and `versions.json` so the version numbers match.
2. Commit the changes.
3. Create and push a tag that exactly matches the manifest version, for example:

```bash
git tag 1.0.0
git push origin 1.0.0
```

The release workflow builds the plugin, verifies the tag matches `manifest.json`, and uploads:

- `main.js`
- `manifest.json`
- `styles.css`

Obsidian uses those release assets for community plugin installation and updates.

## License

MIT
