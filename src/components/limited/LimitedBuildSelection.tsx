import { Button } from "@/components/ui/button";
import type { DraftCard } from "@/types/limited";

interface Props {
  availableSelection: string[];
  move: (ids: string[], zone: "main" | "pool" | "maybe") => void;
  setSelectedIds: (ids: string[]) => void;
  deck: { sideboard: DraftCard[] };
}
export function LimitedBuildSelection({ availableSelection, move, setSelectedIds, deck }: Props) {
  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto text-xs">
      <span className="whitespace-nowrap tabular-nums text-muted-foreground">
        {availableSelection.length} selected
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={!availableSelection.length}
        onClick={() => move(availableSelection, "main")}
      >
        Add to main
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!availableSelection.length}
        onClick={() => move(availableSelection, "pool")}
      >
        Remove / return to pool
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!availableSelection.length}
        onClick={() => move(availableSelection, "maybe")}
      >
        Maybe
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={!availableSelection.length}
        onClick={() => setSelectedIds([])}
      >
        Clear selection
      </Button>
      <span className="whitespace-nowrap text-muted-foreground">
        Sideboard {deck.sideboard.length}. Maybe is included.
      </span>
    </div>
  );
}
