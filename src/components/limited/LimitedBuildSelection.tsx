import { Button } from "@/components/ui/button";

interface Props {
  availableSelection: string[];
  move: (ids: string[], zone: "main" | "pool" | "maybe") => void;
  setSelectedIds: (ids: string[]) => void;
}
export function LimitedBuildSelection({ availableSelection, move, setSelectedIds }: Props) {
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto rounded-md bg-card/70 px-2 text-xs [&>button]:shrink-0">
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
        Return to pool
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
    </div>
  );
}
