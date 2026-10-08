import { useEffect } from "react";
import { closeGameSounds, playGameSound, unlockGameSounds } from "@/lib/gameSounds";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useGameStore } from "@/stores/useGameStore";

export function useGameSounds() {
  const enabled = usePreferencesStore((s) => s.gameplaySounds);
  useEffect(() => {
    if (!enabled) return;
    document.addEventListener("pointerdown", unlockGameSounds);
    document.addEventListener("keydown", unlockGameSounds);
    let lastPromptId = useGameStore.getState().currentPrompt?.promptId;
    const unsubscribe = useGameStore.subscribe((state) => {
      if (!state.isGameActive || !state.gameView) {
        lastPromptId = undefined;
        return;
      }
      const prompt = state.currentPrompt;
      if (!prompt || prompt.promptId === lastPromptId) return;
      lastPromptId = prompt.promptId;
      if (
        state.myPlayerSlot &&
        prompt.decidingPlayerId === state.myPlayerSlot &&
        !state.selfConceded
      )
        playGameSound("decision");
    });
    return () => {
      document.removeEventListener("pointerdown", unlockGameSounds);
      document.removeEventListener("keydown", unlockGameSounds);
      unsubscribe();
      closeGameSounds();
    };
  }, [enabled]);
}
