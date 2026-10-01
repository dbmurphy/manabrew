import { Fragment, type MouseEvent } from "react";
import { LimitedCardCanvas } from "@/components/limited/LimitedCardCanvas";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { Button } from "@/components/ui/button";
import { useCardPreview } from "@/hooks/useCardPreview";
import { useLongPressPreview } from "@/hooks/useLongPressPreview";
import { useDeckCard } from "@/lib/limited.utils";
import { deckCardToPreviewDto } from "@/lib/scryfall.utils";
import { cn } from "@/lib/utils";
import type { DraftCard } from "@/types/limited";
import type { BuildGroup } from "@/components/limited/useLimitedBuildStore";
import type { CardDto } from "@/protocol/game";
import { peekCard, useScryfallStore } from "@/stores/useScryfallStore";
interface Props {
  title: string;
  zone: "pool" | "main" | "maybe";
  cards: DraftCard[];
  total: number;
  selectedIds: string[];
  onSelect: (card: DraftCard, additive: boolean) => void;
  onMove: (ids: string[], zone: "pool" | "main" | "maybe") => void;
  onDrop: (card: DraftCard, x: number, y: number) => void;
  group: BuildGroup;
  cardSize: number;
  mode: "gallery" | "list";
  className?: string;
}
export function LimitedBuildZone({
  title,
  zone,
  cards,
  total,
  selectedIds,
  onSelect,
  onMove,
  onDrop,
  group,
  cardSize,
  mode,
  className,
}: Props) {
  const preview = useCardPreview([mode]);
  const cache = useScryfallStore((state) => state.cards);
  const labels = cards.map((card) => {
    const info = peekCard(cache, card);
    const type = info?.card_faces?.[0]?.type_line ?? info?.type_line;
    const colors = info?.colors ?? info?.card_faces?.[0]?.colors ?? [];
    if (group === "none") return "";
    if (!info) return "Details pending";
    if (group === "cmc") return type?.includes("Land") ? "Lands" : `Mana value ${info.cmc}`;
    if (group === "color")
      return type?.includes("Land") ? "Lands" : colors.length ? colors.join(" / ") : "Colorless";
    if (group === "type") return type?.split("—")[0].trim() ?? "Unknown type";
    return info.rarity;
  });
  return (
    <section
      data-limited-zone={zone}
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-2">
        <h3 className="font-serif text-lg">
          {title}{" "}
          <span className="font-sans text-xs tabular-nums text-muted-foreground">{total}</span>
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => cards.forEach((card, index) => onSelect(card, index > 0))}
          disabled={!cards.length}
        >
          Select visible
        </Button>
      </header>
      {cards.length ? (
        mode === "gallery" ? (
          <LimitedCardCanvas
            cards={cards}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onActivate={(card) => onMove([card.id], zone === "main" ? "pool" : "main")}
            onDrop={onDrop}
            groupBy={group}
            cardSize={cardSize}
            className="min-h-0 flex-1"
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            <ul className="space-y-1">
              {cards.map((card, index) => (
                <Fragment key={card.id}>
                  {labels[index] && labels[index] !== labels[index - 1] && (
                    <li className="px-2 pt-3 text-xs font-semibold capitalize text-muted-foreground">
                      {labels[index]}
                    </li>
                  )}
                  <CardRow
                    card={card}
                    selected={selectedIds.includes(card.id)}
                    onSelect={onSelect}
                    onMove={onMove}
                    zone={zone}
                    onInspect={(dto, anchor) =>
                      preview.showSticky(dto, undefined, undefined, anchor)
                    }
                    onHover={(dto, event) =>
                      preview.handleMouseEnter(dto, event, { useDelay: true })
                    }
                    onLeave={preview.handleMouseLeave}
                    onDismiss={preview.dismiss}
                  />
                </Fragment>
              ))}
            </ul>
          </div>
        )
      ) : (
        <p className="p-5 text-sm text-muted-foreground">
          {total
            ? "No cards match your filters."
            : zone === "main"
              ? "Select pool cards, then Add to main."
              : zone === "maybe"
                ? "Set cards aside with Maybe. They stay in your sideboard."
                : "All acquired cards are in your main deck or Maybe."}
        </p>
      )}
      <HoverCardPreview preview={preview} imageSize="normal" />
    </section>
  );
}
function CardRow({
  card,
  selected,
  onSelect,
  onMove,
  zone,
  onInspect,
  onHover,
  onLeave,
  onDismiss,
}: Pick<Props, "onSelect" | "onMove" | "zone"> & {
  card: DraftCard;
  selected: boolean;
  onInspect: (card: CardDto, anchor: HTMLElement | DOMRect) => void;
  onHover: (card: CardDto, event: MouseEvent) => void;
  onLeave: () => void;
  onDismiss: () => void;
}) {
  const deckCard = useDeckCard(card);
  const dto = deckCard ? deckCardToPreviewDto(deckCard) : null;
  const longPress = useLongPressPreview({
    resolve: (event) => (dto ? { item: dto, anchor: event.currentTarget as HTMLElement } : null),
    show: onInspect,
    hide: onDismiss,
  });
  return (
    <li
      className={cn(
        "flex items-center gap-1 rounded border border-border px-2 py-1",
        selected && "border-selection bg-selection/10",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        className="min-h-11 min-w-0 flex-1 text-left text-sm focus-visible:outline-2 focus-visible:outline-primary"
        onClick={(event) => onSelect(card, event.shiftKey || event.metaKey || event.ctrlKey)}
        onMouseEnter={(event) => {
          if (dto) onHover(dto, event);
        }}
        onMouseLeave={onLeave}
        {...longPress}
      >
        <span className="block truncate font-medium">
          {card.name}
          {card.foil ? " · Foil" : ""}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {card.setCode.toUpperCase()} {card.cardNumber}
        </span>
      </button>
      <Button
        variant="ghost"
        size="sm"
        disabled={!dto}
        aria-label={`Inspect ${card.name}`}
        onClick={(event) => {
          if (dto) onInspect(dto, event.currentTarget);
        }}
      >
        Inspect
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label={`${zone === "main" ? "Remove" : "Add"} ${card.name}`}
        onClick={() => onMove([card.id], zone === "main" ? "pool" : "main")}
      >
        {zone === "main" ? "Remove" : "Add"}
      </Button>
    </li>
  );
}
