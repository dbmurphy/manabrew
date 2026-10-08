import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BookOpen, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTutorialStore } from "@/stores/useTutorialStore";
import { useGameStore } from "@/stores/useGameStore";
import { useIsTouch } from "@/hooks/useBreakpoints";
import { ROUTES } from "@/lib/constants";

const STEPS = [
  {
    title: "Choose both decks",
    body: "Choose a format, then pick your deck and an AI opponent. Preset decks let you try a game without building a deck first.",
  },
  {
    title: "Start your first game",
    body: "Use the setup screen's start button when both decks are ready. Loading can take a moment. Then keep or mulligan your opening hand when prompted.",
  },
  {
    title: "Inspect your hand",
    body: "Read a card's cost and rules before playing it. Your hand is at the bottom of the board. Only highlighted actions are available for the current decision.",
  },
  {
    title: "Play and pass priority",
    body: "When you have priority, play a land or cast a highlighted card you can afford. The action pill lets you pass to the next decision. Read targeting and payment prompts before confirming. Full control lets you respond instead of automatically passing.",
  },
];

export function TutorialStartButton() {
  const status = useTutorialStore((s) => s.status);
  const start = useTutorialStore((s) => s.start);
  const isGameActive = useGameStore((s) => s.isGameActive);
  const navigate = useNavigate();
  return (
    <Button
      variant="outline"
      onClick={() => {
        start(isGameActive);
        navigate(isGameActive ? ROUTES.PLAY : ROUTES.PLAY_OFFLINE_CONSTRUCTED);
      }}
    >
      <BookOpen />
      {status === "paused"
        ? "Resume first-game tutorial"
        : status === "complete"
          ? "Replay first-game tutorial"
          : status === "active"
            ? "Return to first-game tutorial"
            : "Start first-game tutorial"}
    </Button>
  );
}

export function FirstGameTutorial() {
  const { status, step, setupReady, pause, next, enterGame, restartSetup } = useTutorialStore();
  const isGameActive = useGameStore((s) => s.isGameActive);
  const hasBoard = useGameStore((s) => s.gameView !== null);
  const isTouch = useIsTouch();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (isGameActive && hasBoard) enterGame();
  }, [isGameActive, hasBoard, enterGame]);
  if (status !== "active") return null;
  const onSetup = location.pathname === ROUTES.PLAY_OFFLINE_CONSTRUCTED;
  const onBoard =
    location.pathname.startsWith(ROUTES.GAME) || location.pathname.startsWith(ROUTES.PLAY);
  const needsGame = step >= 2;
  const canContinue = needsGame
    ? isGameActive && hasBoard && onBoard
    : step === 0 && onSetup && setupReady;
  const current = STEPS[step];
  return (
    <aside
      aria-label="First-game tutorial"
      className="shrink-0 border-t border-border bg-card text-card-foreground px-4 pt-2 pb-[max(0.5rem,var(--safe-area-inset-bottom))] pl-[max(1rem,var(--safe-area-inset-left))] pr-[max(1rem,var(--safe-area-inset-right))] max-h-[35dvh] overflow-auto"
    >
      <div className="mx-auto max-w-4xl space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold" aria-live="polite">
            Tutorial {step + 1} of {STEPS.length}: {current.title}
          </h2>
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={collapsed ? "Expand tutorial" : "Collapse tutorial"}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <ChevronUp /> : <ChevronDown />}
            </Button>
            <Button variant="ghost" size="sm" onClick={pause}>
              Pause
            </Button>
          </div>
        </div>
        {!collapsed && (
          <>
            <p className="text-sm text-muted-foreground">{current.body}</p>
            {step === 2 && (
              <p className="text-sm text-muted-foreground">
                {isTouch
                  ? "Tap a card to pin its preview. Tap outside to close it."
                  : "Hover a card to inspect it. Right-click for its available actions."}
              </p>
            )}
            {needsGame && !isGameActive && (
              <p className="text-sm text-muted-foreground">
                Start an offline game to continue these board steps.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {!isGameActive && !onSetup && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    restartSetup();
                    navigate(ROUTES.PLAY_OFFLINE_CONSTRUCTED);
                  }}
                >
                  Open offline setup
                </Button>
              )}
              {needsGame && isGameActive && !onBoard && (
                <Button variant="outline" size="sm" onClick={() => navigate(ROUTES.PLAY)}>
                  Return to game
                </Button>
              )}
              {needsGame && !isGameActive && onSetup && (
                <Button variant="outline" size="sm" onClick={restartSetup}>
                  Repeat setup steps
                </Button>
              )}
              {step !== 1 && (
                <Button variant="primary" size="sm" disabled={!canContinue} onClick={next}>
                  {step === 3
                    ? "Finish tutorial"
                    : step === 0
                      ? "Both decks ready"
                      : "I've inspected my hand"}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
