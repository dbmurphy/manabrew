import { useCallback, useRef, useState } from "react";
import { usePhaseStopStore, getNextStop, getEndTurnStop } from "@/stores/usePhaseStopStore";
import type { Prompt, PromptOutput, PassUntil } from "@/protocol";
import { passOutput } from "@/components/prompts/internal/playerActions";
import { usePromptPreferencesStore } from "@/stores/usePromptPreferencesStore";
import type { GameViewDto } from "@/protocol/game";

interface UsePromptEffectsOptions {
  currentPrompt: Prompt | null;
  gameView: GameViewDto | null;
  isWaitingForResponse: boolean;
  respond: (output: PromptOutput["output"]) => void;
  myPlayerId: string;
}

export function usePromptEffects({
  currentPrompt,
  gameView,
  isWaitingForResponse,
  respond,
  myPlayerId,
}: UsePromptEffectsOptions) {
  const confirmPassWithMana = usePromptPreferencesStore((s) => s.confirmPassWithMana);
  const [pendingPass, setPendingPass] = useState<{
    prompt: Prompt;
    until: PassUntil | null;
    exhaustStack: boolean;
  } | null>(null);
  const pendingPassRef = useRef<typeof pendingPass>(null);
  const floatingMana = Object.values(
    gameView?.players.find(
      (player) => player.id === (currentPrompt?.decidingPlayerId ?? myPlayerId),
    )?.manaPool ?? {},
  ).reduce((total, amount) => total + amount, 0);
  const passConfirmationOpen =
    pendingPass !== null &&
    pendingPass.prompt === currentPrompt &&
    currentPrompt.input.type === "chooseAction" &&
    confirmPassWithMana &&
    floatingMana > 0 &&
    !isWaitingForResponse;
  const pass = useCallback(
    (until: PassUntil | null, exhaustStack = false) => {
      if (currentPrompt?.input.type === "chooseAction" && confirmPassWithMana && floatingMana > 0) {
        const request = { prompt: currentPrompt, until, exhaustStack };
        pendingPassRef.current = request;
        setPendingPass(request);
        return;
      }
      const out = passOutput(currentPrompt, until, exhaustStack);
      if (out) respond(out);
    },
    [currentPrompt, respond, confirmPassWithMana, floatingMana],
  );
  const unifiedPass = useCallback(() => {
    if (!currentPrompt || !gameView || isWaitingForResponse) return;

    const gv = gameView;
    if ((gv.stack?.length ?? 0) > 0) {
      pass(null);
      return;
    }

    const store = usePhaseStopStore.getState();
    const nextStop = getNextStop(
      gv.players.filter((p) => p.status === "playing").map((p) => p.id),
      gv.activePlayerId,
      gv.step,
      myPlayerId,
      store.selfStops,
      store.getOpponentStops,
    );

    pass(nextStop ? { ...nextStop, throughCombat: false } : null);
  }, [currentPrompt, gameView, isWaitingForResponse, pass, myPlayerId]);

  const unifiedPassEndTurn = useCallback(() => {
    if (!currentPrompt || !gameView || isWaitingForResponse) return;
    if ((gameView.stack?.length ?? 0) > 0) {
      pass(null, true);
      return;
    }

    const store = usePhaseStopStore.getState();
    const target = getEndTurnStop(
      gameView.players.filter((p) => p.status === "playing").map((p) => p.id),
      gameView.activePlayerId,
      myPlayerId,
      store.selfStops,
      store.getOpponentStops,
    );

    pass(target ? { ...target, throughCombat: true } : null);
  }, [currentPrompt, gameView, isWaitingForResponse, pass, myPlayerId]);

  const confirmPass = () => {
    if (passConfirmationOpen && pendingPass && pendingPassRef.current === pendingPass) {
      const out = passOutput(currentPrompt, pendingPass.until, pendingPass.exhaustStack);
      pendingPassRef.current = null;
      setPendingPass(null);
      if (out) respond(out);
    }
  };
  const cancelPass = () => {
    pendingPassRef.current = null;
    setPendingPass(null);
  };

  return {
    passConfirmationOpen,
    confirmPass,
    cancelPass,
    floatingMana,
    unifiedPass,
    unifiedPassEndTurn,
  };
}
