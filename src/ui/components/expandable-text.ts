import { t } from "../../i18n";

const SHORT_LENGTH = 220;

export function renderExpandableText(
  container: HTMLElement,
  fullText: string,
  expanded: boolean,
  onToggle: () => void,
  opts?: { wrapperCls?: string; textCls?: string },
): HTMLElement {
  const wrapper = container.createDiv({
    cls: opts?.wrapperCls ?? "mediavault-detail-description",
  });

  const textEl = wrapper.createEl("p", {
    cls: opts?.textCls ?? "mediavault-detail-synopsis",
  });

  const needsToggle = fullText.length > SHORT_LENGTH;
  const text =
    needsToggle && !expanded
      ? fullText.slice(0, SHORT_LENGTH).trimEnd() + "..."
      : fullText;

  textEl.appendText(text);

  if (!needsToggle) return wrapper;

  const toggle = textEl.createSpan({
    cls: "mediavault-detail-description-toggle",
    text: expanded ? ` ${t("common.showLess")}` : ` ${t("common.showMore")}`,
  });

  toggle.addEventListener("click", (evt) => {
    evt.stopPropagation();
    onToggle();
  });

  return wrapper;
}
