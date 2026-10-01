import { GAME_CARD_SIZES } from "@/components/game/game.constants";
import { MANA_LETTERS } from "@/themes/gameTheme";
import type { DraftCard } from "@/types/limited";
import type { ScryfallCard } from "@/types/scryfall";

export type LimitedGrouping = "none" | "color" | "cmc" | "type" | "rarity";
export const LIMITED_GAP = 16;
export const LIMITED_PADDING = 16;
export const LIMITED_GROUP_HEADER = 32;
export const LIMITED_DRAG_THRESHOLD = 8;
export interface LimitedCell {
  card: DraftCard;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LimitedLayout {
  cells: LimitedCell[];
  headers: { label: string; y: number }[];
  height: number;
  columns: number;
}

function groupLabel(info: ScryfallCard | null, groupBy: LimitedGrouping): string {
  if (groupBy === "none") return "";
  if (!info) return "Loading card details";
  if (groupBy === "cmc") return `${info.cmc} mana`;
  if (groupBy === "rarity") return info.rarity.charAt(0).toUpperCase() + info.rarity.slice(1);
  if (groupBy === "type") return (info.type_line.split(" — ")[0] ?? info.type_line).trim();
  const colors = info.colors ?? info.color_identity;
  if (!colors.length) return "Colorless";
  if (colors.length > 1) return "Multicolor";
  const names: Record<string, string> = {
    W: "White",
    U: "Blue",
    B: "Black",
    R: "Red",
    G: "Green",
    C: "Colorless",
  };
  return names[colors[0]] ?? "Colorless";
}

export function limitedLayout(
  cards: DraftCard[],
  width: number,
  size: number,
  groupBy: LimitedGrouping,
  metadata: (card: DraftCard) => ScryfallCard | null,
): LimitedLayout {
  const cardWidth = Math.min(Math.max(60, size), Math.max(60, width - LIMITED_PADDING * 2));
  const cardHeight = (cardWidth * GAME_CARD_SIZES.hand.height) / GAME_CARD_SIZES.hand.width;
  const columns = Math.max(
    1,
    Math.floor((width - LIMITED_PADDING * 2 + LIMITED_GAP) / (cardWidth + LIMITED_GAP)),
  );
  const groups = new Map<string, DraftCard[]>();
  for (const card of cards) {
    const label = groupLabel(metadata(card), groupBy);
    const group = groups.get(label) ?? [];
    group.push(card);
    groups.set(label, group);
  }
  const colorOrder = [
    ...MANA_LETTERS.map(
      (letter) =>
        ({ W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless" })[letter],
    ),
    "Multicolor",
    "Loading card details",
  ];
  const labels = [...groups.keys()];
  if (groupBy === "color") labels.sort((a, b) => colorOrder.indexOf(a) - colorOrder.indexOf(b));
  if (groupBy === "cmc") labels.sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0));
  if (groupBy === "type" || groupBy === "rarity") labels.sort((a, b) => a.localeCompare(b));
  const cells: LimitedCell[] = [];
  const headers: LimitedLayout["headers"] = [];
  let y = LIMITED_PADDING;
  for (const label of labels) {
    const group = groups.get(label)!;
    if (label) {
      headers.push({ label: `${label} · ${group.length}`, y });
      y += LIMITED_GROUP_HEADER;
    }
    group.forEach((card, index) =>
      cells.push({
        card,
        x: LIMITED_PADDING + (index % columns) * (cardWidth + LIMITED_GAP),
        y: y + Math.floor(index / columns) * (cardHeight + LIMITED_GAP),
        width: cardWidth,
        height: cardHeight,
      }),
    );
    y += Math.ceil(group.length / columns) * (cardHeight + LIMITED_GAP);
  }
  return { cells, headers, height: Math.max(y, LIMITED_PADDING * 2), columns };
}
