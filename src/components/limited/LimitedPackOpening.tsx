import { LimitedCardCanvas } from "@/components/limited/LimitedCardCanvas";
import { useLimitedPackOpening } from "@/components/limited/useLimitedPackOpening";
import { Button } from "@/components/ui/button";
import { useIsMobileGame } from "@/hooks/useBreakpoints";
import { cn } from "@/lib/utils";
import type { SealedPool } from "@/types/limited";

export function LimitedPackOpening({
  sessionKey,
  packs,
  onComplete,
}: {
  sessionKey: string;
  packs: SealedPool["packs"];
  onComplete: () => void;
}) {
  const compact = useIsMobileGame();
  const {
    openedIds,
    openedCount,
    nextPack,
    activePack,
    preparing,
    poolCards,
    openingCardIds,
    openingPackCount,
    openingSetCode,
    revealing,
    imageError,
    arrival,
    reveal,
    finishReveal,
    openRemaining,
    review,
    complete,
  } = useLimitedPackOpening(sessionKey, packs, onComplete);
  return (
    <section
      aria-label="Open sealed boosters"
      className={cn(
        "flex h-full min-h-0 flex-1 flex-col overflow-hidden",
        compact ? "gap-2 p-2" : "gap-3 p-3",
      )}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <h2 className="rounded bg-card/70 px-2 py-1 font-serif text-lg">Open your boosters</h2>
        <p
          role="status"
          aria-live="polite"
          className="rounded bg-card/70 px-2 py-1 text-xs text-muted-foreground"
        >
          {preparing
            ? "Preparing booster images…"
            : `${openedCount} of ${packs.length} boosters opened`}
        </p>
        {(nextPack || revealing || preparing) && (
          <Button variant="outline" size="sm" onClick={complete}>
            Skip opening
          </Button>
        )}
      </header>
      {imageError && (
        <p role="status" className="text-sm text-muted-foreground">
          Some card images could not load. Card names remain available.
        </p>
      )}
      <div className="flex shrink-0 gap-2 overflow-x-auto" aria-label="Opened boosters">
        {packs.map((pack, index) => (
          <Button
            key={pack.id}
            className="shrink-0"
            size="sm"
            variant={activePack?.id === pack.id ? "selected" : "outline"}
            disabled={!openedIds.includes(pack.id) || preparing || revealing}
            onClick={() => review(pack.id)}
            aria-label={`Review booster ${index + 1}${pack.setCode ? `, ${pack.setCode}` : ""}`}
            aria-pressed={activePack?.id === pack.id}
          >
            Booster {index + 1}
            {pack.setCode && ` · ${pack.setCode.toUpperCase()}`}
          </Button>
        ))}
      </div>
      {activePack || revealing || poolCards.length > 0 ? (
        <section aria-label="Opened card pool" className="flex min-h-0 flex-1 flex-col">
          <h3 className="mx-auto rounded bg-card/70 px-2 py-1 font-serif text-lg">
            Pool <span className="font-sans text-xs text-muted-foreground">{poolCards.length}</span>
          </h3>
          <LimitedCardCanvas
            cards={poolCards}
            selectedIds={!revealing && activePack ? openingCardIds : undefined}
            presentation="grid"
            arrivalKey={`${sessionKey}:${arrival}`}
            opening={revealing}
            openingPackCount={openingPackCount}
            openingSetCode={openingSetCode}
            openingCardIds={openingCardIds}
            onOpeningComplete={finishReveal}
            onSkipOpening={complete}
            className="min-h-0 w-full flex-1"
          />
        </section>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
          <p className="rounded bg-card/70 px-2 py-1 font-serif text-2xl">
            {packs.length} boosters at your table
          </p>
          <p className="rounded bg-card/70 px-2 py-1 text-sm text-muted-foreground">
            Open a booster to inspect its cards.
          </p>
        </div>
      )}
      <div className="flex shrink-0 flex-wrap justify-center gap-2">
        {nextPack ? (
          <Button
            variant="primary"
            size="sm"
            disabled={preparing || revealing}
            onClick={() => void reveal(nextPack)}
          >
            Open next
          </Button>
        ) : (
          <Button variant="primary" size="sm" disabled={revealing || preparing} onClick={complete}>
            Build deck
          </Button>
        )}
        {nextPack && (
          <Button
            variant="outline"
            size="sm"
            disabled={preparing || revealing}
            onClick={() => void openRemaining()}
          >
            Open all
          </Button>
        )}
      </div>
    </section>
  );
}
