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
    revealing,
    openAll,
    imageError,
    arrival,
    reveal,
    openRemaining,
    review,
    complete,
  } = useLimitedPackOpening(sessionKey, packs, onComplete);
  return (
    <section
      aria-label="Open sealed boosters"
      className={cn(
        "flex h-full min-h-0 flex-1 flex-col rounded-xl border border-border bg-card text-card-foreground",
        compact ? "gap-2 p-2" : "gap-4 p-4",
      )}
    >
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          {!compact && (
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Your sealed pool
            </p>
          )}
          <h2 className={cn("font-serif", compact ? "text-xl" : "text-3xl")}>Open your boosters</h2>
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {preparing
              ? "Preparing booster images…"
              : `${openedCount} of ${packs.length} boosters opened`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {nextPack ? (
            <Button
              variant="primary"
              disabled={preparing || revealing || openAll}
              onClick={() => void reveal(nextPack)}
            >
              Open next
            </Button>
          ) : (
            <Button variant="primary" disabled={revealing || preparing} onClick={complete}>
              Build deck
            </Button>
          )}
          {nextPack && (
            <Button
              variant="outline"
              disabled={openAll || preparing || revealing}
              onClick={() => void openRemaining()}
            >
              Open all
            </Button>
          )}
          <Button variant="ghost" onClick={complete}>
            {nextPack || revealing ? "Skip opening" : "Continue"}
          </Button>
        </div>
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
            variant={activePack?.id === pack.id ? "selected" : "outline"}
            disabled={!openedIds.includes(pack.id) || preparing || revealing || openAll}
            onClick={() => review(pack.id)}
            aria-label={`Review booster ${index + 1}${pack.setCode ? `, ${pack.setCode}` : ""}`}
            aria-pressed={activePack?.id === pack.id}
          >
            Booster {index + 1}
            {pack.setCode && ` · ${pack.setCode.toUpperCase()}`}
          </Button>
        ))}
      </div>
      {activePack ? (
        <LimitedCardCanvas
          cards={activePack.cards}
          arrivalKey={`${sessionKey}:${activePack.id}:${arrival}`}
          opening={revealing}
          className={cn("flex-1", compact ? "min-h-24" : "min-h-64")}
        />
      ) : (
        <div
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30",
            compact ? "min-h-24" : "min-h-64",
          )}
        >
          <p className="font-serif text-2xl">{packs.length} boosters at your table</p>
          <p className="text-sm text-muted-foreground">Open a booster to inspect its cards.</p>
        </div>
      )}
    </section>
  );
}
