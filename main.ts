import { App, getIcon, ItemView, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, WorkspaceLeaf, moment, MarkdownRenderer, getFrontMatterInfo} from 'obsidian';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	postsFolder: string;
}

const POSTS_VIEW_TYPE = 'posts-view';

const DEFAULT_SETTINGS: MyPluginSettings = {
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

		const echoChamberRiconIconEl = this.addRibbonIcon('message-square-text', 'Post to your Echo Chamber', (evt: MouseEvent) => {
			this.openPostsView();
		});
		echoChamberRiconIconEl.addClass('my-plugin-ribbon-class');
		this.addCommand({
			id: 'open-posts-view',
			name: 'Open Post View',
			callback: () => {
				this.openPostsView();
			},
		});


		this.addSettingTab(new EchoChamberSettingsTab(this.app, this));
	}

	async openPostsView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(POSTS_VIEW_TYPE);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getLeaf();
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

	protected async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('post-view-container');

		/* Input Area */
		const inputContainer = container.createDiv('post-input-container');
		const textArea = inputContainer.createEl('textarea', { placeholder: "What's happening?" });
		textArea.addClass('post-input-textarea'); // Class for styling

		textArea.addEventListener('keydown', async (event) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();

				const content = textArea.value.trim();

				if (!content) {
					console.log("Content is empty. Note not created.");
					return;
				}

				try {
					await this.ensureFolderExists(this.plugin.settings.postsFolder);

					// Generating a unique filename (using timestamps);
					const now = new Date();
					const timestamp = now.toISOString().replace(/[:.]/g, '-');
					const fileName = `${timestamp}.md`;
					const filePath = `${this.plugin.settings.postsFolder}/${fileName}`;
					await this.app.vault.create(filePath, content);
					new Notice(`Note created: ${fileName}`);
					textArea.value = '';

					// Update the timeline naively;
					await this.renderTimeline();

				} catch (error) {
					console.error("Error creating note:", error);
					new Notice(`Error creating note: ${error.message}`);
				}
			}
		});

		/* Notes List Area */
		this.notesListContainer = container.createDiv('notes-list-container');
		this.notesListContainer.id = 'post-notes-list';
		await this.renderTimeline();
		this.registerVaultEvents();
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

	async renderTimeline(): Promise<void> {
		if (!this.notesListContainer) {
			console.error("Notes list container is not initialized.");
			return;
		}

		const listContainer = this.notesListContainer;
		listContainer.empty();

		try {
			const folder = this.app.vault.getAbstractFileByPath(this.plugin.settings.postsFolder);
			if (!folder || !(folder instanceof TFolder)) {
				listContainer.createEl('p', { text: `No posts at "${this.plugin.settings.postsFolder}".` });
				return;
			}

			const notes = this.app.vault.getMarkdownFiles().filter(file =>
				file.path.startsWith(this.plugin.settings.postsFolder + '/')
			);

			notes.sort((a, b) => b.stat.mtime - a.stat.mtime);

			if (notes.length === 0) {
				listContainer.createEl('p', { text: `No notes found in "${this.plugin.settings.postsFolder}".` });
			} else {
				const ul = listContainer.createEl('ul', 'post-notes-ul');
				notes.forEach(this.renderPost.bind(this, ul));
			}
		} catch (error) {
			console.error("Error rendering notes list:", error);
			listContainer.empty();
			listContainer.createEl('p', { text: `Error loading notes: ${error.message}` });
			new Notice(`Error loading notes: ${error.message}`);
		}
	}

	async renderPost(container: HTMLUListElement, noteFile: TFile) {
        const li = container.createEl('li', 'post-item');

		let frontMatter = null;

        /* Header: Username and Timestamp */
        const postHeader = li.createDiv('post-header');
        const usernameEl = postHeader.createSpan('post-username');
        usernameEl.setText('You');
        const timestampEl = postHeader.createSpan('post-timestamp');
        timestampEl.setText(moment(noteFile.stat.mtime).fromNow());

        /* Content */
        const postContentEl = li.createDiv('post-content');
        try {
            const content = await this.app.vault.read(noteFile);
			frontMatter = getFrontMatterInfo(content);
            await MarkdownRenderer.render(this.app, content, postContentEl, noteFile.path, this);
        } catch (error) {
            console.error(`Error reading note ${noteFile.name}:`, error);
            postContentEl.setText(`Error loading post content.`);
        }

        /* Actions */
        const postActions = li.createDiv('post-actions');

        const heartButton = postActions.createEl('button', { cls: 'post-action-button post-heart-button' });
        const heartIcon = getIcon('heart');
        if (heartIcon) {
            heartButton.appendChild(heartIcon);
        } else {
            heartButton.setText('Like');
        }

        heartButton.addEventListener('click', () => {
            heartButton.classList.toggle('liked');
			this.app.fileManager.processFrontMatter(noteFile, (frontmatter: any) => {
				frontmatter['liked'] = heartButton.hasClass('liked');
			}
        });

        const openButton = postActions.createEl('button', { cls: 'post-action-button post-open-button' });
        const openIcon = getIcon('external-link');
        if (openIcon) {
            openButton.appendChild(openIcon);
        } else {
            openButton.setText('Open');
        }
        openButton.addEventListener('click', (ev) => {
            ev.preventDefault();
            this.app.workspace.openLinkText(noteFile.path, '', false);
        });
    }

	registerVaultEvents(): void {
		const postsFolderPath = this.plugin.settings.postsFolder;

		this.registerEvent(this.app.vault.on('create', (file) => {
			if (file instanceof TFile && file.path.startsWith(postsFolderPath + '/')) {
				this.renderTimeline();
			}
		}));

		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (file instanceof TFile && file.path.startsWith(postsFolderPath + '/')) {
				this.renderTimeline();
			}
		}));

		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (file instanceof TFile && file.path.startsWith(postsFolderPath + '/')) {
				this.renderTimeline();
			}
		}));

		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			const isInPostsFolder = file instanceof TFile && file.path.startsWith(postsFolderPath + '/');
			const wasInPostsFolder = oldPath.startsWith(postsFolderPath + '/');

			if (isInPostsFolder || wasInPostsFolder) {
				this.renderTimeline();
			}
		}));
	}

	protected async onClose(): Promise<void> {
		// Nothing to clean up. So far! I think...
	}
}