import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	postsFolder: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	postsFolder: '/'
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		const echoChamberRiconIconEl = this.addRibbonIcon('dice', 'Echo Chamber', (evt: MouseEvent) => {
			new Notice('You\'re addicted to Twitter!');
		});
		echoChamberRiconIconEl.addClass('my-plugin-ribbon-class');

		this.addSettingTab(new EchoChamberSettingsTab(this.app, this));
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
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

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
