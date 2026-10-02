import { Fragment, type MouseEvent } from "react";
import { LimitedCardCanvas } from "@/components/limited/LimitedCardCanvas";
import { CardHoverPreview } from "@/components/game/CardHoverPreview";
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
  acquiredIds: readonly string[];
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
  acquiredIds,
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
  const preview = useCardPreview([mode, cards]);
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
      aria-label={zone === "main" ? "Main deck" : `${title} / sideboard`}
      className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden", className)}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-1 px-2">
        <h3 className="rounded bg-card/70 px-2 py-1 font-serif text-base">
          {title}{" "}
          <span className="font-sans text-xs tabular-nums text-muted-foreground">{total}</span>
        </h3>
        {cards.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => cards.forEach((card, index) => onSelect(card, index > 0))}
            className="bg-card/70 text-xs"
          >
            Select visible
          </Button>
        )}
      </header>
      {cards.length ? (
        mode === "gallery" ? (
          <LimitedCardCanvas
            cards={cards}
            acquiredIds={acquiredIds}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onActivate={(card) => onMove([card.id], zone === "main" ? "pool" : "main")}
            onDrop={onDrop}
            groupBy={group}
            cardSize={cardSize}
            presentation="columns"
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
                      preview.handleMouseEnter(dto, event, { useAnchor: true, useDelay: true })
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
        <p className="mx-2 mt-3 rounded-md bg-card/60 px-2 py-3 text-center text-xs text-muted-foreground">
          {total
            ? "No cards match your filters."
            : zone === "main"
              ? "Add cards from your pool."
              : zone === "maybe"
                ? "Set aside cards for later."
                : "No unassigned cards."}
        </p>
      )}
      <CardHoverPreview preview={preview} />
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
    hideOnRelease: false,
  });
  return (
    <li
      className={cn(
        "flex items-center gap-1 rounded bg-card/70 px-2 py-1",
        selected && "bg-selection/20 ring-1 ring-selection",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        className="min-h-11 min-w-0 flex-1 text-left text-sm focus-visible:outline-2 focus-visible:outline-primary"
        onClick={(event) => onSelect(card, event.shiftKey || event.metaKey || event.ctrlKey)}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch" && dto) onHover(dto, event);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch") onLeave();
        }}
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
