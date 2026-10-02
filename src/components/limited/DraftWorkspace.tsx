import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LimitedCardCanvas } from "@/components/limited/LimitedCardCanvas";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { useLimitedBuildStore } from "@/components/limited/useLimitedBuildStore";
import { useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";
import { cn } from "@/lib/utils";
import type { ConspiracyHook, DraftCard, DraftState } from "@/types/limited";

interface DraftWorkspaceProps {
  draft: DraftState;
  onPick: (card: DraftCard) => void | Promise<void>;
  pickPending?: boolean;
  conspiracyHooks?: ConspiracyHook[];
}
export function DraftWorkspace({
  draft,
  onPick,
  pickPending = false,
  conspiracyHooks = [],
}: DraftWorkspaceProps) {
  const [mobileTab, setMobileTab] = useState<"pack" | "build">("pack");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const builderRef = useRef<HTMLElement>(null);
  const acquiredIds = useMemo(() => draft.pickedPile.map((card) => card.id), [draft.pickedPile]);
  const poolTarget = useCallback(
    () => builderRef.current?.querySelector<HTMLElement>('[data-limited-zone="pool"]') ?? null,
    [],
  );
  const quickPick = useLimitedBuildStore((state) => state.quickPick);
  const shortScreen = useIsShortScreen();
  const isTouch = useIsTouch();
  const shortTouch = shortScreen && isTouch;
  const selected = draft.currentPack.find((card) => card.id === selectedId);
  const disabled = !draft.awaitingHuman || pickPending || submitting;
  const submit = async (card: DraftCard) => {
    if (disabled || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onPick(card);
      setSelectedId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The pick wasn't accepted. Try again.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };
  const select = (card: DraftCard) => {
    if (disabled) return;
    setSelectedId(card.id);
    if (quickPick) void submit(card);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div
        role="tablist"
        aria-label="Draft workspace"
        className={cn("flex shrink-0 gap-1 lg:hidden", shortTouch && "lg:flex")}
      >
        <Button
          role="tab"
          aria-selected={mobileTab === "pack"}
          variant={mobileTab === "pack" ? "selected" : "ghost"}
          size="sm"
          onClick={() => setMobileTab("pack")}
        >
          Pack · {draft.currentPack.length}
        </Button>
        <Button
          role="tab"
          aria-selected={mobileTab === "build"}
          variant={mobileTab === "build" ? "selected" : "ghost"}
          size="sm"
          onClick={() => setMobileTab("build")}
        >
          Pool / build · {draft.pickedPile.length}
        </Button>
      </div>
      <div
        className={cn(
          "grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden lg:grid-rows-[minmax(0,min(42%,24rem))_minmax(0,1fr)]",
          shortTouch && "lg:grid-rows-1",
        )}
      >
        <section
          className={cn(
            "flex min-h-0 flex-col overflow-hidden",
            mobileTab !== "pack" && "hidden lg:flex",
            shortTouch && mobileTab !== "pack" && "lg:hidden",
          )}
          aria-label="Current booster"
        >
          <header className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 px-3">
            <h2 className="rounded bg-card/70 px-2 py-1 font-serif text-lg">
              Booster{" "}
              <span className="font-sans text-xs text-muted-foreground">
                {draft.currentPack.length}
              </span>
            </h2>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded bg-card/70 px-2 text-xs">
              <input
                type="checkbox"
                checked={quickPick}
                onChange={(event) =>
                  useLimitedBuildStore.getState().setQuickPick(event.target.checked)
                }
              />
              Quick pick
            </label>
          </header>
          <LimitedCardCanvas
            cards={draft.currentPack}
            selectedIds={selected ? [selected.id] : []}
            onSelect={select}
            onActivate={(card) => {
              setSelectedId(card.id);
              void submit(card);
            }}
            disabled={disabled}
            presentation="spread"
            arrivalDirection={draft.passDirection === "left" ? "right" : "left"}
            acquiredIds={acquiredIds}
            departureTarget={poolTarget}
            arrivalKey={`${draft.sessionId}:${draft.round}:${draft.pickNumber}`}
            emptyMessage={
              draft.isComplete
                ? "Draft complete. Finish your build."
                : "Waiting for the next booster..."
            }
            className="min-h-0 flex-1"
          />
          <footer className="flex shrink-0 items-center justify-center gap-3 px-3 py-1">
            <p aria-live="polite" className="min-w-0 truncate rounded bg-card/70 px-2 py-1 text-sm">
              {selected
                ? selected.name
                : draft.awaitingHuman
                  ? "Choose a card"
                  : "Waiting for the table."}
            </p>
            <Button
              variant="primary"
              size="sm"
              disabled={!selected || disabled}
              className="shrink-0"
              onClick={() => {
                if (selected) void submit(selected);
              }}
            >
              {pickPending || submitting ? "Picking..." : "Confirm pick"}
            </Button>
          </footer>
        </section>
        <section
          ref={builderRef}
          className={cn(
            "flex min-h-0 min-w-0 flex-col gap-2",
            mobileTab !== "build" && "hidden lg:flex",
            shortTouch && mobileTab !== "build" && "lg:hidden",
          )}
          aria-label="Your acquired pool and deck"
        >
          {!!draft.humanConspiracies?.length && (
            <details className="mx-2 min-w-0 max-w-xl shrink-0 text-xs">
              <summary className="cursor-pointer rounded bg-card/70 px-2 py-1 font-semibold">
                Conspiracies · {draft.humanConspiracies.length}
              </summary>
              <ul className="max-h-24 space-y-1 overflow-y-auto rounded bg-card/90 p-2">
                {draft.humanConspiracies.map((name) => (
                  <li key={name}>
                    <span className="font-medium">{name}</span>
                    {conspiracyHooks.find((hook) => hook.cardName === name)?.description && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {conspiracyHooks.find((hook) => hook.cardName === name)?.description}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="min-h-0 flex-1">
            <LimitedDeckBuilder
              key={draft.sessionId}
              sessionKey={draft.sessionId}
              pool={draft.pickedPile}
              defaultDeckName="Booster Draft Deck"
              format="draft"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
