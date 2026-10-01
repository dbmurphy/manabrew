import { useState } from "react";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsDesktop } from "@/hooks/useBreakpoints";
import { LimitedCardCanvas } from "@/components/limited/LimitedCardCanvas";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import type { WinstonState } from "@/types/limited";

interface WinstonWorkspaceProps {
  activeWinston: WinstonState;
  activeIdx: number;
  onTake: () => void;
  onPass: () => void;
}

export function WinstonWorkspace({
  activeWinston,
  activeIdx,
  onTake,
  onPass,
}: WinstonWorkspaceProps) {
  const desktop = useIsDesktop();
  const [tab, setTab] = useState<"piles" | "deck">("piles");
  const activePile = activeWinston.piles[activeIdx] ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {!desktop && (
        <div className="flex gap-2" role="tablist" aria-label="Winston workspace">
          <Button
            role="tab"
            aria-selected={tab === "piles"}
            variant={tab === "piles" ? "primary" : "outline"}
            onClick={() => setTab("piles")}
          >
            Piles
          </Button>
          <Button
            role="tab"
            aria-selected={tab === "deck"}
            variant={tab === "deck" ? "primary" : "outline"}
            onClick={() => setTab("deck")}
          >
            Build · {activeWinston.pickedPile.length}
          </Button>
        </div>
      )}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        {(desktop || tab === "piles") && (
          <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-primary/50 bg-primary/5">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
              <div>
                <h2 className="text-sm font-semibold text-primary">Pile {activeIdx + 1}</h2>
                <p className="text-xs text-muted-foreground">{activePile.length} cards</p>
              </div>
              {activeWinston.awaitingHuman && (
                <div className="flex gap-2">
                  <Button variant="primary" onClick={onTake} disabled={activePile.length === 0}>
                    Take pile
                  </Button>
                  <Button variant="outline" onClick={onPass}>
                    Pass
                  </Button>
                </div>
              )}
            </header>
            <LimitedCardCanvas
              cards={activePile}
              arrivalKey={`${activeWinston.sessionId}:${activeIdx}:${activePile.map((card) => card.id).join(",")}`}
              className="min-h-0 flex-1"
            />
            <footer className="flex flex-wrap gap-3 border-t border-border/50 p-3">
              {activeWinston.piles.map((pile, index) =>
                index === activeIdx ? null : (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                  >
                    <Layers className="size-4" aria-hidden="true" />
                    <span>
                      Pile {index + 1} · {pile.length} face down
                    </span>
                  </div>
                ),
              )}
            </footer>
          </section>
        )}
        {(desktop || tab === "deck") && (
          <LimitedDeckBuilder
            key={activeWinston.sessionId}
            sessionKey={activeWinston.sessionId}
            pool={activeWinston.pickedPile}
            defaultDeckName="Winston Draft Deck"
            format="draft"
          />
        )}
      </div>
    </div>
  );
}
