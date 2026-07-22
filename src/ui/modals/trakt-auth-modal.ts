import { App, Modal, Notice } from "obsidian";
import { renderMobileBackButton } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import { requestDeviceCode, pollDeviceToken } from "../../api/trakt-auth";

/**
 * Walks the user through Trakt's device-code OAuth flow: request a code,
 * show it alongside the verification URL, then poll on Trakt's given
 * interval until the user approves it (or it expires/is denied).
 */
export class TraktAuthModal extends Modal {
	private storage: StorageService;
	private onConnected?: () => void;
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private cancelled = false;

	constructor(app: App, storage: StorageService, onConnected?: () => void) {
		super(app);
		this.storage = storage;
		this.onConnected = onConnected;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mediavault-trakt-auth-modal");
		renderMobileBackButton(this, contentEl);
		contentEl.createEl("h2", { text: "Connect Trakt" });

		const settings = this.storage.settings.get();
		if (!settings.traktClientId || !settings.traktClientSecret) {
			contentEl.createDiv({
				text: "Add your Trakt client ID and client secret above first, then reopen this dialog.",
				cls: "mediavault-trakt-auth-error",
			});
			return;
		}

		const statusEl = contentEl.createDiv({ cls: "mediavault-trakt-auth-status", text: "Requesting a device code..." });

		try {
			const device = await requestDeviceCode(settings.traktClientId);

			statusEl.empty();
			statusEl.createEl("p", { text: "Go to:" });
			const link = statusEl.createEl("a", {
				text: device.verificationUrl,
				href: device.verificationUrl,
			});
			link.setAttr("target", "_blank");
			statusEl.createEl("p", { text: "And enter this code:" });
			statusEl.createEl("div", { text: device.userCode, cls: "mediavault-trakt-code" });
			statusEl.createEl("p", {
				text: "Waiting for approval...",
				cls: "mediavault-trakt-auth-waiting",
			});

			this.startPolling(settings.traktClientId, settings.traktClientSecret, device, statusEl);
		} catch (err) {
			statusEl.setText(`Failed to start Trakt authorization — ${(err as Error).message}`);
		}
	}

	private startPolling(
		clientId: string,
		clientSecret: string,
		device: Awaited<ReturnType<typeof requestDeviceCode>>,
		statusEl: HTMLElement
	): void {
		const deadline = Date.now() + device.expiresIn * 1000;

		const poll = async () => {
			if (this.cancelled) return;
			if (Date.now() > deadline) {
				statusEl.createEl("p", { text: "Code expired — reopen this dialog to try again.", cls: "mediavault-trakt-auth-error" });
				return;
			}

			try {
				const result = await pollDeviceToken(clientId, clientSecret, device.deviceCode);

				if (result.status === "pending") {
					this.pollTimer = setTimeout(poll, device.interval * 1000);
					return;
				}

				if (result.status === "approved") {
					await this.storage.settings.update({
						traktAccessToken: result.token.accessToken,
						traktRefreshToken: result.token.refreshToken,
						traktTokenExpiresAt: Date.now() + result.token.expiresInSeconds * 1000,
					});
					new Notice("MediaVault: Trakt connected.");
					this.onConnected?.();
					this.close();
					return;
				}

				if (result.status === "denied") {
					statusEl.createEl("p", { text: "Authorization denied.", cls: "mediavault-trakt-auth-error" });
					return;
				}

				if (result.status === "expired") {
					statusEl.createEl("p", { text: "Code expired — reopen this dialog to try again.", cls: "mediavault-trakt-auth-error" });
					return;
				}
			} catch (err) {
				statusEl.createEl("p", { text: `Error: ${(err as Error).message}`, cls: "mediavault-trakt-auth-error" });
			}
		};

		void poll();
	}

	onClose(): void {
		this.cancelled = true;
		if (this.pollTimer) clearTimeout(this.pollTimer);
		this.contentEl.empty();
	}
}
