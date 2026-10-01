import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { LimitedBuildSaveActions } from "@/components/limited/LimitedBuildSaveActions";
import { LimitedBuildConfigurations } from "@/components/limited/LimitedBuildConfigurations";
import { LimitedManaDialog } from "@/components/limited/LimitedManaDialog";
import { LimitedCompareDialog } from "@/components/limited/LimitedCompareDialog";
import { useLimitedBuildStore, type BuildSession } from "@/components/limited/useLimitedBuildStore";
import { BASIC_LAND_NAMES, type BasicLandName } from "@/lib/limited.utils";
import { cn } from "@/lib/utils";
import type { DraftCard } from "@/types/limited";
import type { DeckFormat } from "@/protocol/deck";

type BuildDeck = { main: DraftCard[]; sideboard: DraftCard[] };
interface Props {
  sessionKey: string;
  session: BuildSession;
  deck: BuildDeck;
  shortTouch: boolean;
  initialMain?: DraftCard[];
  initialSideboard?: DraftCard[];
  defaultDeckName: string;
  targetMainSize: number;
  requireCompleteToSave: boolean;
  format: DeckFormat;
  onSaved?: (deckName: string) => void;
  onConfirm?: (deck: BuildDeck) => void;
  confirmLabel: string;
}
export function LimitedBuildActions({
  sessionKey,
  session,
  deck,
  shortTouch,
  initialMain,
  initialSideboard,
  defaultDeckName,
  targetMainSize,
  requireCompleteToSave,
  format,
  onSaved,
  onConfirm,
  confirmLabel,
}: Props) {
  const [dialog, setDialog] = useState<"mana" | "builds" | "compare" | null>(null);
  return (
    <>
      <div
        className={cn(
          "flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2",
          shortTouch && "flex-nowrap overflow-x-auto",
        )}
      >
        <span className="whitespace-nowrap font-serif text-lg">Your build</span>
        <Button
          variant="outline"
          size="sm"
          disabled={!session.undo.length}
          onClick={() => useLimitedBuildStore.getState().undo(sessionKey)}
        >
          Undo
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!session.redo.length}
          onClick={() => useLimitedBuildStore.getState().redo(sessionKey)}
        >
          Redo
        </Button>
        <AppSelect
          aria-label="Add basic land"
          value=""
          onValueChange={(name) => {
            void useLimitedBuildStore
              .getState()
              .addBasic(sessionKey, name as BasicLandName)
              .catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : "Couldn't add this basic."),
              );
          }}
        >
          <AppSelectOption value="">Add basic</AppSelectOption>
          {BASIC_LAND_NAMES.map((name) => (
            <AppSelectOption key={name} value={name}>
              {name}
            </AppSelectOption>
          ))}
        </AppSelect>
        <Button variant="outline" size="sm" onClick={() => setDialog("mana")}>
          Suggest lands
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDialog("builds")}>
          Builds
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDialog("compare")}>
          Compare saved
        </Button>
        {!!initialMain?.length && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              useLimitedBuildStore
                .getState()
                .suggest(sessionKey, initialMain, initialSideboard ?? [])
            }
          >
            Use suggested build
          </Button>
        )}
        <LimitedBuildSaveActions
          deck={deck}
          defaultDeckName={defaultDeckName}
          targetMainSize={targetMainSize}
          requireCompleteToSave={requireCompleteToSave}
          format={format}
          onSaved={onSaved}
        />
        {onConfirm && (
          <Button
            variant="primary"
            size="sm"
            className="shrink-0"
            disabled={deck.main.length < targetMainSize}
            onClick={() => onConfirm(deck)}
          >
            {confirmLabel}
          </Button>
        )}
      </div>
      {dialog === "mana" && (
        <LimitedManaDialog
          sessionKey={sessionKey}
          session={session}
          main={deck.main}
          targetMainSize={targetMainSize}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "builds" && (
        <LimitedBuildConfigurations
          sessionKey={sessionKey}
          session={session}
          onClose={() => setDialog(null)}
        />
      )}
      <LimitedCompareDialog
        current={deck.main}
        open={dialog === "compare"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
    </>
  );
}
