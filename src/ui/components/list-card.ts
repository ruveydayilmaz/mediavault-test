import { CustomList } from "../../models/list";
import { MediaItem } from "../../models/media";
import {
  getListBannerPosters,
  formatRelativeDate,
} from "../../services/list-service";
import { renderPoster } from "./media-render";
import { t } from "../../i18n";

/**
 * Renders a list card using the same banner+scrim style as the Lists page
 * grid, so any surface (Lists view, Add to List modal, etc.) shows lists
 * identically. `onClick` receives the card element so callers can add
 * transient state (e.g. a success flash) on top of it.
 */
export function renderListCard(
  container: HTMLElement,
  list: CustomList,
  allMedia: MediaItem[],
  onClick: (card: HTMLElement) => void,
): HTMLElement {
  const card = container.createDiv({ cls: "mediavault-list-card" });

  const bannerPosters = getListBannerPosters(list, allMedia);
  const banner = card.createDiv({ cls: "mediavault-list-banner" });
  for (let i = 0; i < 4; i++) {
    const cell = banner.createDiv({ cls: "mediavault-list-banner-cell" });
    const media = bannerPosters[i];
    if (media) {
      renderPoster(cell, media, "w200");
    } else {
      cell.addClass("is-empty");
    }
  }

  const scrim = banner.createDiv({ cls: "mediavault-list-card-scrim" });
  scrim.createDiv({ cls: "mediavault-list-card-title", text: list.title });
  if (list.description) {
    scrim.createDiv({
      cls: "mediavault-list-card-description",
      text: list.description,
    });
  }
  const meta = scrim.createDiv({ cls: "mediavault-list-card-meta" });
  meta.createSpan({
    text: t("lists.itemCountN", {
      count: list.mediaIds.length,
      plural: list.mediaIds.length === 1 ? "" : "s",
    }),
  });
  meta.createSpan({
    text: t("lists.updated", { date: formatRelativeDate(list.updatedAt) }),
  });
  meta.createSpan({ text: list.owner ?? t("common.you") });
  if (list.isImported) {
    meta.createSpan({
      cls: "mediavault-list-card-imported",
      text: t("lists.imported"),
    });
  }

  card.addEventListener("click", () => onClick(card));

  return card;
}
