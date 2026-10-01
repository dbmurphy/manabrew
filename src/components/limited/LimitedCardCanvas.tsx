import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { GAME_CARD_SIZES } from "@/components/game/game.constants";
import {
  LimitedCardInspector,
  type LimitedInspection,
} from "@/components/limited/LimitedCardInspector";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LimitedCardScene } from "@/pixi/limited/LimitedCardScene";
import { limitedLayout, type LimitedGrouping } from "@/pixi/limited/limitedLayout";
import { peekCard, useScryfallStore } from "@/stores/useScryfallStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { DraftCard } from "@/types/limited";

export interface LimitedCardCanvasProps {
  cards: DraftCard[];
  selectedIds?: readonly string[];
  onSelect?: (card: DraftCard, additive: boolean) => void;
  onActivate?: (card: DraftCard) => void;
  onDrop?: (card: DraftCard, clientX: number, clientY: number) => void;
  disabled?: boolean;
  cardSize?: number;
  groupBy?: LimitedGrouping;
  className?: string;
  arrivalKey?: string;
  opening?: boolean;
}
const NO_SELECTION: readonly string[] = [];
export function LimitedCardCanvas({
  cards,
  selectedIds = NO_SELECTION,
  onSelect,
  onActivate,
  onDrop,
  disabled = false,
  cardSize = GAME_CARD_SIZES.hand.width,
  groupBy = "none",
  className,
  arrivalKey,
  opening = false,
}: LimitedCardCanvasProps) {
  const scrollHost = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const scene = useRef<LimitedCardScene | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [scrollTop, setScrollTop] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<LimitedInspection | null>(null);
  const visibleInspection =
    inspection && cards.some((card) => card.id === inspection.card.id) ? inspection : null;
  const activeFocusedId = cards.some((card) => card.id === focusedId) ? focusedId : null;
  const inspectionRef = useRef<LimitedInspection | null>(null);
  useLayoutEffect(() => {
    inspectionRef.current = visibleInspection;
  }, [visibleInspection]);
  const hoverTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);
  const bucket = useScryfallStore((state) => state.cards);
  const locale = useScryfallStore((state) => state.locale);
  const hoverDelay = usePreferencesStore((state) => state.cardHoverDelayMs);
  const layout = useMemo(
    () =>
      limitedLayout(cards, viewport.width, cardSize, groupBy, (card) =>
        peekCard(bucket, {
          name: card.name,
          setCode: card.setCode,
          collectorNumber: card.cardNumber,
        }),
      ),
    [cards, viewport.width, cardSize, groupBy, bucket],
  );
  const clearTimers = useCallback(() => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    hoverTimer.current = null;
    leaveTimer.current = null;
  }, []);
  const inspect = useCallback(
    (card: DraftCard | null, sticky: boolean) => {
      if (inspectionRef.current?.sticky && !sticky) return;
      clearTimers();
      if (!card) {
        leaveTimer.current = window.setTimeout(() => setInspection(null), 220);
        return;
      }
      if (sticky) setInspection({ card, sticky });
      else
        hoverTimer.current = window.setTimeout(() => setInspection({ card, sticky }), hoverDelay);
    },
    [clearTimers, hoverDelay, setInspection],
  );
  const props = {
    layout,
    ...viewport,
    scrollTop,
    selectedIds,
    disabled,
    arrivalKey,
    opening,
    onSelect,
    onActivate,
    onDrop,
    onInspect: inspect,
  };
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  useEffect(() => {
    const host = scrollHost.current;
    if (!host) return;
    const observer = new ResizeObserver(() =>
      setViewport({ width: host.clientWidth, height: host.clientHeight }),
    );
    observer.observe(host);
    setViewport({ width: host.clientWidth, height: host.clientHeight });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const host = canvasHost.current;
    if (!host) return;
    const current = new LimitedCardScene(host, latest.current, setError);
    scene.current = current;
    void current.init();
    return () => {
      current.destroy();
      scene.current = null;
      clearTimers();
    };
  }, [clearTimers]);
  useEffect(() => {
    scene.current?.update(props);
  });
  useEffect(() => {
    if (groupBy === "none") return;
    for (const card of cards)
      void useScryfallStore
        .getState()
        .getCard({ name: card.name, setCode: card.setCode, collectorNumber: card.cardNumber })
        .catch(() => undefined);
  }, [cards, groupBy, locale]);
  useEffect(clearTimers, [cards, clearTimers]);
  const focusCard = (index: number) => {
    const cell = layout.cells[Math.max(0, Math.min(layout.cells.length - 1, index))];
    if (!cell || !scrollHost.current) return;
    const host = scrollHost.current;
    if (cell.y < host.scrollTop) host.scrollTop = cell.y;
    else if (cell.y + cell.height > host.scrollTop + host.clientHeight)
      host.scrollTop = cell.y + cell.height - host.clientHeight;
    buttons.current.get(cell.card.id)?.focus({ preventScroll: true });
  };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -layout.columns,
      ArrowDown: layout.columns,
    };
    if (event.key in offsets) {
      event.preventDefault();
      focusCard(index + offsets[event.key]);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusCard(event.key === "Home" ? 0 : layout.cells.length - 1);
    } else if (event.key === "Enter" && onActivate) {
      event.preventDefault();
      onActivate(layout.cells[index].card);
    } else if (event.key.toLowerCase() === "i") {
      event.preventDefault();
      inspect(layout.cells[index].card, true);
    } else if (event.key === "Escape") {
      scene.current?.abort();
      clearTimers();
      setInspection(null);
    }
  };
  const focused =
    cards.find((card) => card.id === focusedId) ??
    cards.find((card) => selectedIds.includes(card.id));
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex min-h-11 shrink-0 items-center gap-2 px-3 text-xs text-muted-foreground">
        <span className="shrink-0">{cards.length} cards</span>
        <span className="min-w-0 flex-1 truncate">
          Select to choose · Enter to activate · I to inspect
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          disabled={!focused}
          onClick={() => focused && inspect(focused, true)}
        >
          Inspect
        </Button>
      </div>
      {error && (
        <p role="status" className="px-3 text-sm text-muted-foreground">
          Card canvas unavailable. Use the card controls below. {error}
        </p>
      )}
      <div
        ref={scrollHost}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
          clearTimers();
          if (!inspectionRef.current?.sticky) setInspection(null);
        }}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg bg-muted/30"
      >
        <div className="relative" style={{ height: Math.max(viewport.height, layout.height) }}>
          <div
            ref={canvasHost}
            className={cn("sticky top-0 overflow-hidden", error && "invisible")}
            style={{ height: viewport.height }}
          />
          {layout.cells.map((cell, index) => (
            <button
              key={cell.card.id}
              ref={(node) => {
                if (node) buttons.current.set(cell.card.id, node);
                else buttons.current.delete(cell.card.id);
              }}
              type="button"
              disabled={disabled}
              aria-label={`${cell.card.name}, ${cell.card.setCode}, ${cell.card.cardNumber}, copy ${index + 1}`}
              aria-pressed={selectedIds.includes(cell.card.id)}
              tabIndex={cell.card.id === (activeFocusedId ?? layout.cells[0]?.card.id) ? 0 : -1}
              onFocus={() => setFocusedId(cell.card.id)}
              onKeyDown={(event) => keyboard(event, index)}
              onPointerDown={(event) => scene.current?.pressCard(cell.card.id, event.nativeEvent)}
              onPointerEnter={(event) => scene.current?.hoverCard(cell.card.id, event.pointerType)}
              onPointerLeave={(event) => scene.current?.hoverCard(null, event.pointerType)}
              onContextMenu={(event) => {
                event.preventDefault();
                inspect(cell.card, true);
              }}
              onClick={(event) => {
                if (event.detail === 0 || error)
                  onSelect?.(cell.card, event.ctrlKey || event.metaKey || event.shiftKey);
              }}
              onDoubleClick={() => {
                if (error) onActivate?.(cell.card);
              }}
              className={cn(
                "absolute z-[2] cursor-pointer rounded-md p-2 text-sm opacity-0 focus-visible:opacity-100 focus-visible:bg-card focus-visible:text-card-foreground focus-visible:outline-2 focus-visible:outline-primary",
                error && "bg-card opacity-100",
                selectedIds.includes(cell.card.id) && "ring-2 ring-selection",
              )}
              style={{
                left: cell.x,
                top: cell.y,
                width: cell.width,
                height: cell.height,
                touchAction: "pan-y",
              }}
            >
              {cell.card.name}
            </button>
          ))}
          {!cards.length && (
            <p className="absolute inset-x-0 top-8 text-center text-sm text-muted-foreground">
              No cards in this zone.
            </p>
          )}
        </div>
      </div>
      {visibleInspection && (
        <LimitedCardInspector
          key={visibleInspection.card.id}
          inspection={visibleInspection}
          onClose={() => {
            clearTimers();
            setInspection(null);
          }}
          onEnter={clearTimers}
          onLeave={() => {
            if (!visibleInspection.sticky) inspect(null, false);
          }}
        />
      )}
    </div>
  );
}
