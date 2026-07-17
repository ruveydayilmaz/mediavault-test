import { App, FuzzySuggestModal } from "obsidian";
import { MediaItem } from "../../models/media";

export class SelectMediaModal extends FuzzySuggestModal<MediaItem> {
	private items: MediaItem[];
	private onSelect: (item: MediaItem) => void;

	constructor(app: App, items: MediaItem[], onSelect: (item: MediaItem) => void) {
		super(app);
		this.items = items;
		this.onSelect = onSelect;
		this.setPlaceholder("Choose a movie or TV show from your library...");
	}

	getItems(): MediaItem[] {
		return this.items;
	}

	getItemText(item: MediaItem): string {
		return item.year ? `${item.title} (${item.year})` : item.title;
	}

	onChooseItem(item: MediaItem): void {
		this.onSelect(item);
	}
}
