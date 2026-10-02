import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { LimitedBuildZone } from "@/components/limited/LimitedBuildZone";
import { LimitedBuildFilters, type BuildFilters } from "@/components/limited/LimitedBuildFilters";
import { LimitedDeckStats } from "@/components/limited/LimitedDeckStats";
import { buildDeck, useLimitedBuildStore } from "@/components/limited/useLimitedBuildStore";
import { LimitedBuildActions } from "@/components/limited/LimitedBuildActions";
import { LimitedBuildSelection } from "@/components/limited/LimitedBuildSelection";
import { useLimitedBuildCards } from "@/components/limited/useLimitedBuildCards";
import { useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";
import { cn } from "@/lib/utils";
import type { DraftCard } from "@/types/limited";
import type { DeckFormat } from "@/protocol/deck";
import type { CSSProperties } from "react";
export interface LimitedDeckBuilderProps {
  sessionKey: string;
  pool: DraftCard[];
  initialMain?: DraftCard[];
  initialSideboard?: DraftCard[];
  suggestedMain?: DraftCard[];
  targetMainSize?: number;
  defaultDeckName?: string;
  format?: DeckFormat;
  requireCompleteToSave?: boolean;
  onChange?: (deck: { main: DraftCard[]; sideboard: DraftCard[] }) => void;
  confirmLabel?: string;
  onConfirm?: (deck: { main: DraftCard[]; sideboard: DraftCard[] }) => void;
  onSaved?: (deckName: string) => void;
}
export default function LimitedDeckBuilder({
  sessionKey,
  pool,
  initialMain,
  initialSideboard,
  suggestedMain,
  targetMainSize = 40,
  defaultDeckName = "Limited Deck",
  format = "draft",
  requireCompleteToSave = false,
  onChange,
  confirmLabel = "Save Deck",
  onConfirm,
  onSaved,
}: LimitedDeckBuilderProps) {
  const session = useLimitedBuildStore((state) => state.sessions[sessionKey]);
  const [filters, setFilters] = useState<BuildFilters>({ search: "", colors: [], type: "all" });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mobileZone, setMobileZone] = useState<"pool" | "main" | "maybe">("pool");
  const shortScreen = useIsShortScreen();
  const isTouch = useIsTouch();
  const shortTouch = shortScreen && isTouch;
  const acquired = session?.pool;
  const allocation = session?.allocation;
  const basics = allocation?.basics;
  const group = session?.group;
  const initialized = !!session;
  const changeRef = useRef(onChange);
  useLayoutEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    useLimitedBuildStore.getState().sync(sessionKey, pool, initialMain, initialSideboard);
  }, [sessionKey, pool, initialMain, initialSideboard]);
  const cards = useMemo(
    () => (acquired && basics ? [...acquired, ...basics] : []),
    [acquired, basics],
  );
  const acquiredIds = useMemo(() => cards.map((card) => card.id), [cards]);
  const deck = useMemo(
    () =>
      acquired && allocation
        ? buildDeck({ pool: acquired, allocation })
        : { main: [], sideboard: [] },
    [acquired, allocation],
  );
  useEffect(() => {
    if (initialized) changeRef.current?.(deck);
  }, [deck, initialized]);
  const filtered = useLimitedBuildCards(cards, filters, group);
  const select = useCallback((card: DraftCard, additive: boolean) => {
    setSelectedIds((current) =>
      additive
        ? current.includes(card.id)
          ? current.filter((id) => id !== card.id)
          : [...current, card.id]
        : [card.id],
    );
  }, []);
  const move = useCallback(
    (ids: string[], zone: "main" | "pool" | "maybe") => {
      useLimitedBuildStore.getState().move(sessionKey, ids, zone);
    },
    [sessionKey],
  );
  const drop = useCallback(
    (card: DraftCard, x: number, y: number) => {
      const zone = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-limited-zone]")
        ?.dataset.limitedZone;
      if (zone === "main" || zone === "pool" || zone === "maybe")
        move(selectedIds.includes(card.id) ? selectedIds : [card.id], zone);
    },
    [move, selectedIds],
  );
  if (!session)
    return (
      <p role="status" className="p-3 text-sm text-muted-foreground">
        Restoring your build...
      </p>
    );
  const mainIds = new Set(session.allocation.mainIds);
  const maybeIds = new Set(session.allocation.maybeIds);
  const availableSelection = selectedIds.filter((id) => cards.some((card) => card.id === id));
  const zones = [
    {
      id: "pool",
      title: "Pool",
      cards: filtered.filter((card) => !mainIds.has(card.id) && !maybeIds.has(card.id)),
      total: cards.filter((card) => !mainIds.has(card.id) && !maybeIds.has(card.id)).length,
    },
    {
      id: "main",
      title: "Main",
      cards: filtered.filter((card) => mainIds.has(card.id)),
      total: deck.main.length,
    },
    {
      id: "maybe",
      title: "Maybe",
      cards: filtered.filter((card) => maybeIds.has(card.id)),
      total: cards.filter((card) => maybeIds.has(card.id)).length,
    },
  ] as const;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex max-h-[40%] shrink-0 flex-wrap items-start gap-1 overflow-y-auto">
        <LimitedBuildActions
          sessionKey={sessionKey}
          session={session}
          deck={deck}
          shortTouch={shortTouch}
          suggestedMain={suggestedMain ?? initialMain}
          suggestedSideboard={suggestedMain ? undefined : initialSideboard}
          defaultDeckName={defaultDeckName}
          targetMainSize={targetMainSize}
          requireCompleteToSave={requireCompleteToSave}
          format={format}
          onSaved={onSaved}
          onConfirm={onConfirm}
          confirmLabel={confirmLabel}
        />
        <details className="min-w-0 flex-1 basis-56 rounded-md bg-card/75 px-2 [&[open]]:basis-full">
          <summary className="min-h-8 cursor-pointer py-2 text-xs text-muted-foreground">
            Filters, view & stats
            {(filters.search || filters.colors.length > 0 || filters.type !== "all") &&
              " · Filtered"}
          </summary>
          <div className="space-y-2 pb-2">
            <LimitedBuildFilters
              filters={filters}
              onChange={setFilters}
              session={session}
              onPreferences={(prefs) =>
                useLimitedBuildStore.getState().preferences(sessionKey, prefs)
              }
            />
            <details>
              <summary className="cursor-pointer py-2 text-xs text-muted-foreground">
                Deck statistics · Main {deck.main.length}/{targetMainSize}+ · Sideboard{" "}
                {deck.sideboard.length}
                {deck.main.length < targetMainSize
                  ? ` · ${targetMainSize - deck.main.length} more needed`
                  : " · Ready to play"}
              </summary>
              <LimitedDeckStats cards={deck.main} />
            </details>
          </div>
        </details>
      </div>
      {availableSelection.length > 0 && (
        <LimitedBuildSelection
          availableSelection={availableSelection}
          move={move}
          setSelectedIds={setSelectedIds}
        />
      )}
      <div
        className={cn("flex shrink-0 gap-1 md:hidden", shortTouch && "md:flex")}
        role="tablist"
        aria-label="Build zones"
      >
        {zones.map((zone) => (
          <Button
            key={zone.id}
            role="tab"
            aria-selected={mobileZone === zone.id}
            variant={mobileZone === zone.id ? "selected" : "ghost"}
            size="sm"
            onClick={() => setMobileZone(zone.id)}
          >
            {zone.id === "pool" ? "Pool" : zone.id === "main" ? "Main" : "Maybe"} {zone.total}
          </Button>
        ))}
      </div>
      <div
        className={cn(
          "grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden md:grid-cols-[var(--limited-build-columns)]",
          shortTouch && "md:grid-cols-1",
        )}
        style={
          {
            "--limited-build-columns": `minmax(0,${Math.max(zones[0].total, 12)}fr) minmax(8rem,${zones[1].total}fr) minmax(8rem,${zones[2].total}fr)`,
          } as CSSProperties
        }
      >
        {zones.map((zone) => (
          <LimitedBuildZone
            key={zone.id}
            title={zone.title}
            zone={zone.id}
            cards={zone.cards}
            acquiredIds={acquiredIds}
            total={zone.total}
            selectedIds={availableSelection}
            onSelect={select}
            onMove={move}
            onDrop={drop}
            group={session.group}
            cardSize={session.cardSize}
            mode={session.mode}
            className={cn(
              mobileZone !== zone.id && "hidden md:flex",
              shortTouch && mobileZone !== zone.id && "md:hidden",
            )}
          />
        ))}
      </div>
    </div>
  );
}
