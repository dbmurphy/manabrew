import { useRef, useState } from "react";
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
  onBuild?: () => void;
  pickPending?: boolean;
  conspiracyHooks?: ConspiracyHook[];
}
export function DraftWorkspace({
  draft,
  onPick,
  onBuild,
  pickPending = false,
  conspiracyHooks = [],
}: DraftWorkspaceProps) {
  const [mobileTab, setMobileTab] = useState<"pack" | "build">("pack");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
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
          "grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.4fr)]",
          shortTouch && "lg:grid-cols-1",
        )}
      >
        <section
          className={cn(
            "flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card",
            mobileTab !== "pack" && "hidden lg:flex",
            shortTouch && mobileTab !== "pack" && "lg:hidden",
          )}
          onKeyDown={(event) => {
            if (
              event.key !== "Enter" ||
              event.target instanceof HTMLInputElement ||
              event.target instanceof HTMLButtonElement ||
              !selected ||
              disabled
            )
              return;
            event.preventDefault();
            void submit(selected);
          }}
          tabIndex={0}
          aria-label="Current booster. Select a card and press Enter to confirm."
        >
          <header className="shrink-0 space-y-2 border-b border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-serif text-xl">Current booster</h2>
              <span className="text-xs text-muted-foreground">
                Round {draft.round}/{draft.totalRounds} · Pick {draft.pickNumber}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {draft.passDirection ? `Pass ${draft.passDirection}` : "Choose from this booster"}
                {draft.picksPerPass > 1
                  ? ` · ${draft.picksRemainingInPack} picks before passing`
                  : ""}
              </span>
              <label className="flex min-h-11 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={quickPick}
                  onChange={(event) =>
                    useLimitedBuildStore.getState().setQuickPick(event.target.checked)
                  }
                />
                Quick pick
              </label>
            </div>
          </header>
          {draft.currentPack.length ? (
            <LimitedCardCanvas
              cards={draft.currentPack}
              selectedIds={selected ? [selected.id] : []}
              onSelect={select}
              onActivate={(card) => {
                setSelectedId(card.id);
                void submit(card);
              }}
              disabled={disabled}
              cardSize={130}
              arrivalKey={`${draft.sessionId}:${draft.round}:${draft.pickNumber}`}
              className="min-h-0 flex-1"
            />
          ) : (
            <p
              role="status"
              className="flex min-h-24 flex-1 items-center justify-center p-4 text-sm text-muted-foreground"
            >
              {draft.isComplete
                ? "Draft complete. Finish your build."
                : "Waiting for the next booster..."}
            </p>
          )}
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border p-3">
            <p aria-live="polite" className="min-w-0 truncate text-sm">
              {selected
                ? selected.name
                : draft.awaitingHuman
                  ? "Select a card, then confirm."
                  : "Waiting for the table."}
            </p>
            <Button
              variant="primary"
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
          className={cn(
            "flex min-h-0 min-w-0 flex-col gap-2",
            mobileTab !== "build" && "hidden lg:flex",
            shortTouch && mobileTab !== "build" && "lg:hidden",
          )}
          aria-label="Your acquired pool and deck"
        >
          {(onBuild || !!draft.humanConspiracies?.length) && (
            <div className="flex shrink-0 items-start justify-between gap-2">
              {!!draft.humanConspiracies?.length && (
                <details className="min-w-0 text-xs">
                  <summary className="cursor-pointer font-semibold">
                    Conspiracies · {draft.humanConspiracies.length}
                  </summary>
                  <ul className="max-h-24 space-y-1 overflow-y-auto pt-2">
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
              {onBuild && (
                <Button variant="outline" size="sm" className="ml-auto" onClick={onBuild}>
                  Expand builder
                </Button>
              )}
            </div>
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
