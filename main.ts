import { App, getIcon, ItemView, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, WorkspaceLeaf, moment, MarkdownRenderer, getFrontMatterInfo, FrontMatterCache, MarkdownView, MarkdownRenderChild, stringifyYaml, parseYaml, normalizePath } from 'obsidian';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	username: string;
	displayName: string;
	postsFolder: string;
}

const POSTS_VIEW_TYPE = 'posts-view';
const POSTS_VIEW_ICON = 'message-square-text';

const DEFAULT_SETTINGS: MyPluginSettings = {
	username: 'local',
	displayName: 'You',
	postsFolder: 'posts'
}

export default class EchoChamberPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			POSTS_VIEW_TYPE,
			(leaf) => new EchoChamberPostsView(leaf, this)
		);

		const echoChamberRiconIconEl = this.addRibbonIcon(POSTS_VIEW_ICON, 'Post to your Echo Chamber', (evt: MouseEvent) => {
			this.openPostsView(false);
		});
		echoChamberRiconIconEl.addClass('my-plugin-ribbon-class');
		this.addCommand({
			id: 'open-posts-view',
			name: 'Open Post View',
			callback: () => {
				this.openPostsView(false);
			},
		});
		this.addCommand({
			id: 'open-posts-view-sidebar',
			name: 'Open Post View On Right Sidebar',
			callback: () => {
				this.openPostsView(true);
			},
		});

		this.addSettingTab(new EchoChamberSettingsTab(this.app, this));
	}

	async openPostsView(sidebar: boolean) {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(POSTS_VIEW_TYPE);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			if (sidebar) {
				leaf = workspace.getRightLeaf(false);
			} else {
				leaf = workspace.getLeaf();
			}
			await (leaf as WorkspaceLeaf).setViewState({ type: POSTS_VIEW_TYPE, active: true });
		}

		workspace.revealLeaf(leaf as WorkspaceLeaf);
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class EchoChamberSettingsTab extends PluginSettingTab {
	plugin: EchoChamberPlugin;

	constructor(app: App, plugin: EchoChamberPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		const profileHeader = containerEl.createEl('h2');
		profileHeader.innerText = "Profile";

		new Setting(containerEl)
			.setName('Username')
			.setDesc('The @ used for your posts!')
			.addText(text => text
				.setPlaceholder('local')
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Display Name')
			.setDesc('The name displayed on your posts!')
			.addText(text => text
				.setPlaceholder('You')
				.setValue(this.plugin.settings.displayName)
				.onChange(async (value) => {
					this.plugin.settings.displayName = value;
					await this.plugin.saveSettings();
				}));

		const storageHeader = containerEl.createEl('h2');
		storageHeader.innerText = "Storage";

		new Setting(containerEl)
			.setName('Posts Folder')
			.setDesc('Folder where the posts are to be stored!')
			.addText(text => text
				.setPlaceholder('/')
				.setValue(this.plugin.settings.postsFolder)
				.onChange(async (value) => {
					this.plugin.settings.postsFolder = value;
					await this.plugin.saveSettings();
				}));
	}
}

interface PostFrontmatter {
	liked?: boolean;
}

class EchoChamberPostsView extends ItemView {
	plugin: EchoChamberPlugin;
	private notesListContainer: HTMLElement | null = null;
	private renderedPosts: Map<string, HTMLElement> = new Map();

	constructor(leaf: WorkspaceLeaf, plugin: EchoChamberPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return POSTS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Your Echo Chamber"
	}

	getIcon() {
		return POSTS_VIEW_ICON;
	}

	protected async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('post-view-container');

		/* Input Area */
		const inputContainer = container.createDiv('post-input-container');
		const textArea = inputContainer.createEl('textarea');
		textArea.placeholder = "What's Happening?";
		textArea.addClass('post-input-textarea'); // Class for styling

		textArea.addEventListener('keydown', async (event) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();

				const content = textArea.value.trim();

				if (!content) {
					console.log("Content is empty. Note not created.");
					return;
				}

				if (await this.createNote(content)) {
					textArea.value = '';
				}
			}
		});

		/* Notes List Area */
		this.notesListContainer = container.createDiv('notes-list-container');
		this.notesListContainer.id = 'post-notes-list';
		await this.renderFullTimeline();
		this.registerVaultEvents();
	}

	private async createNote(rawContent: string): Promise<boolean> {
		try {
			await this.ensureFolderExists(this.plugin.settings.postsFolder);

			// Generating a unique filename (using timestamps);
			const now = new Date();
			const timestamp = now.toISOString().replace(/[:.]/g, '-');
			const fileName = `${timestamp}.md`;
			const filePath = `${this.plugin.settings.postsFolder}/${fileName}`;

			const frontmatterInfo = getFrontMatterInfo(rawContent);
			const newFrontmatter = stringifyYaml({
				liked: false,
				author_username: this.plugin.settings.username,
				author_display_name: this.plugin.settings.displayName,
			});
			const content = `---\n${newFrontmatter}\n---\n${rawContent.slice(frontmatterInfo.contentStart)}`;

			await this.app.vault.create(filePath, content);
			new Notice(`Post created!`);
			return true;
		} catch (error) {
			console.error("Error creating note:", error);
			new Notice(`Error creating note: ${error.message}`);
			return false;
		}
	}

	async ensureFolderExists(folderPath: string): Promise<void> {
		try {
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (folder === null) {
				await this.app.vault.createFolder(folderPath);
				console.log(`Created folder: ${folderPath}`);
			} else if (!(folder instanceof TFolder)) {
				throw new Error(`"${folderPath}" exists but is a file, not a folder.`);
			}
		} catch (error) {
			console.error(`Error ensuring folder "${folderPath}" exists:`, error);
			throw error;
		}
	}

	async insertNewPost(newFile: TFile): Promise<void> {
		if (!this.notesListContainer) {
			console.error("Notes list container is not initialized.");
			return;
		}

		const ul = this.notesListContainer.querySelector('.post-notes-ul');
		if (ul) {
			const newLi = await this.createPostElement(document.createElement('ul'), newFile);
			ul.prepend(newLi);
			this.renderedPosts.set(newFile.path, newLi);
		} else {
			await this.renderFullTimeline();
		}
	}

	async createPostElement(container: HTMLUListElement, file: TFile) {
		const metadata = this.app.metadataCache.getFileCache(file);
		let content = null;
		let frontmatter;
		if (!metadata) {
			content = await this.app.vault.read(file);
			frontmatter = parseYaml(getFrontMatterInfo(content).frontmatter)
		} else {
			frontmatter = metadata.frontmatter;
		}

		const postItem = container.createEl('li', 'post-item');

		/* Header: Username and Timestamp */
		const postHeader = postItem.createDiv('post-header');

		const displayNameEl = postHeader.createSpan('post-display-name');
		displayNameEl.setText(frontmatter['author_display_name'] ?? 'Unknown');

		const usernameEl = postHeader.createSpan('post-username');
		usernameEl.setText(frontmatter['author_username'] ?? 'unknown');

		const timestampEl = postHeader.createSpan('post-timestamp');
		timestampEl.setText(moment(file.stat.mtime).fromNow());

		/* Content */
		const postContentEl = postItem.createDiv('post-content');
		try {
			content ??= await this.app.vault.read(file);
			await MarkdownRenderer.render(this.app, content, postContentEl, normalizePath(file.path), this);
			//await MarkdownRenderer.render(this.app, `![[${noteFile.name}]]`, postContentEl, noteFile.path, this);
		} catch (error) {
			console.error(`Error reading note ${file.name}:`, error);
			postContentEl.setText(`Error loading post content.`);
		}

		/* Actions */
		const postActions = postItem.createDiv('post-actions');
		const heartButton = postActions.createEl('button', { cls: 'post-action-button post-heart-button' });
		const heartIcon = getIcon('heart');
		if (heartIcon) {
			heartButton.appendChild(heartIcon);
		} else {
			heartButton.setText('Like');
		}

		heartButton.classList.toggle('liked', metadata?.frontmatter?.['liked'] || false);
		heartButton.addEventListener('click', async () => {
			let is_liked = heartButton.hasClass('liked');

			heartButton.classList.toggle('liked', !is_liked);
			await this.app.fileManager.processFrontMatter(file, (frontmatter: any) => {
				frontmatter['liked'] = !is_liked;
			});

		});

		const openButton = postActions.createEl('button', { cls: 'post-action-button post-open-button' });
		const openIcon = getIcon('external-link');
		if (openIcon) {
			openButton.appendChild(openIcon);
			openButton.appendText('Open');
		} else {
			openButton.setText('Open');
		}
		openButton.addEventListener('click', (ev) => {
			ev.preventDefault();
			this.app.workspace.openLinkText(file.path, '', 'split');
		});

		return postItem;
	}

	async updatePostElement(file: TFile): Promise<void> {
		const metadata = this.app.metadataCache.getFileCache(file);
		let content = null;
		let frontmatter;
		if (!metadata) {
			content = await this.app.vault.read(file);
			frontmatter = parseYaml(getFrontMatterInfo(content).frontmatter)
		} else {
			frontmatter = metadata.frontmatter;
		}

		const renderedElement = this.renderedPosts.get(file.path);
		if (renderedElement) {
			const postContentEl = renderedElement.querySelector('.post-content');
			const postHeader = renderedElement.querySelector('.post-header');
			if (postContentEl && postContentEl instanceof HTMLElement && postHeader) {
				const displayNameEl = postHeader.querySelector('.post-display-name');
				const usernameEl = postHeader.querySelector('.post-username');
				const timestampEl = postHeader.querySelector('.post-timestamp');
				try {
					content ??= await this.app.vault.read(file);
					postContentEl.empty();
					await MarkdownRenderer.render(this.app, content, postContentEl, normalizePath(file.path), this);
					//await MarkdownRenderer.render(this.app, `![[${file.name}]]`, postContentEl, file.path, this);
					if (displayNameEl) {
						displayNameEl.setText(frontmatter?.['author_display_name'] ?? 'Unknown');
					}
					if (usernameEl) {
						usernameEl.setText(frontmatter?.['author_username'] ?? 'unknown');
					}
					if (timestampEl) {
						timestampEl.setText(moment(file.stat.mtime).fromNow());
					}
				} catch (error) {
					console.error(`Error updating content for ${file.name}:`, error);
					postContentEl.setText(`Error loading post content.`);
				}
			}
		} else {
			console.warn(`Post not found in rendered list for update: ${file.path}`);
			await this.renderFullTimeline();
		}
	}

	async removePostElement(deletedFile: TFile): Promise<void> {
		const renderedElement = this.renderedPosts.get(deletedFile.path);
		if (renderedElement) {
			renderedElement.remove();
			this.renderedPosts.delete(deletedFile.path);
		} else {
			console.warn(`Deleted post not found in rendered list: ${deletedFile.path}`);
			await this.renderFullTimeline();
		}
	}

	async renderFullTimeline(): Promise<void> {
		if (!this.notesListContainer) {
			console.error("Notes list container is not initialized.");
			return;
		}

		const listContainer = this.notesListContainer;
		listContainer.empty();
		this.renderedPosts.clear();

		try {
			const folder = this.app.vault.getAbstractFileByPath(this.plugin.settings.postsFolder);
			if (!folder || !(folder instanceof TFolder)) {
				listContainer.createEl('p', { text: `No posts at "${this.plugin.settings.postsFolder}".` });
				return;
			}

			const notes = this.app.vault.getMarkdownFiles().filter(file =>
				file.path.startsWith(this.plugin.settings.postsFolder + '/')
			);

			notes.sort((a, b) => b.stat.ctime - a.stat.ctime);

			if (notes.length === 0) {
				listContainer.createEl('p', { text: `No notes found in "${this.plugin.settings.postsFolder}".` });
			} else {
				const ul = listContainer.createEl('ul', 'post-notes-ul');
				notes.forEach(async (note) => {
					const li = await this.createPostElement(ul, note);
					this.renderedPosts.set(note.path, li);
				});
			}
		} catch (error) {
			console.error("Error rendering notes list:", error);
			listContainer.empty();
			listContainer.createEl('p', { text: `Error loading notes: ${error.message}` });
			new Notice(`Error loading notes: ${error.message}`);
		}
	}

	registerVaultEvents(): void {
		const postsFolderPath = this.plugin.settings.postsFolder;

		this.registerEvent(this.app.vault.on('create', async (file) => {
			if (file instanceof TFile && file.path.startsWith(postsFolderPath + '/') && file.extension == 'md') {
				await this.insertNewPost(file);
			}
		}));

		this.registerEvent(this.app.vault.on('modify', async (file) => {
			if (file instanceof TFile && file.path.startsWith(postsFolderPath + '/') && file.extension == 'md') {
				await this.updatePostElement(file);
			}
		}));


		this.registerEvent(this.app.vault.on('delete', async (file) => {
			if (file instanceof TFile && file.path.startsWith(postsFolderPath + '/') && file.extension == 'md') {
				await this.removePostElement(file);
			}
		}));

		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			const isInPostsFolder = file instanceof TFile && file.path.startsWith(postsFolderPath + '/');
			const wasInPostsFolder = oldPath.startsWith(postsFolderPath + '/');

			if (isInPostsFolder || wasInPostsFolder) {
				this.renderFullTimeline();
			}
		}));
	}

	protected async onClose(): Promise<void> {
		// Nothing to clean up. So far! I think...
	}
}