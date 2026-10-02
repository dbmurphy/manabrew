import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  suggestedMain?: DraftCard[];
  suggestedSideboard?: DraftCard[];
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
  suggestedMain,
  suggestedSideboard,
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
          "flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-1 rounded-md bg-card/70 px-1 py-1 [&>button]:shrink-0",
          shortTouch && "flex-nowrap gap-2 overflow-x-auto",
        )}
      >
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
        <Button
          variant="ghost"
          size="sm"
          disabled={!session.undo.length}
          onClick={() => useLimitedBuildStore.getState().undo(sessionKey)}
        >
          Undo
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!session.redo.length}
          onClick={() => useLimitedBuildStore.getState().redo(sessionKey)}
        >
          Redo
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0 bg-card/70">
              Build tools
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Add basic land</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {BASIC_LAND_NAMES.map((name) => (
                    <DropdownMenuItem
                      key={name}
                      onSelect={() => {
                        void useLimitedBuildStore
                          .getState()
                          .addBasic(sessionKey, name as BasicLandName)
                          .catch((error: unknown) =>
                            toast.error(
                              error instanceof Error ? error.message : "Couldn't add this basic.",
                            ),
                          );
                      }}
                    >
                      {name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => setDialog("mana")}>Suggest lands</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("builds")}>Named builds</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("compare")}>
              Compare saved builds
            </DropdownMenuItem>
            {!!suggestedMain?.length && (
              <DropdownMenuItem
                onSelect={() =>
                  useLimitedBuildStore
                    .getState()
                    .suggest(sessionKey, suggestedMain, suggestedSideboard ?? [])
                }
              >
                Use suggested build
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={!deck.main.length}
              onSelect={() => useLimitedBuildStore.getState().suggest(sessionKey, [], [])}
            >
              Move all to sideboard
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <LimitedBuildSaveActions
          deck={deck}
          defaultDeckName={defaultDeckName}
          targetMainSize={targetMainSize}
          requireCompleteToSave={requireCompleteToSave}
          format={format}
          onSaved={onSaved}
        />
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
