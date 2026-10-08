import { create } from "zustand";
import { persist } from "zustand/middleware";

type TutorialStep = 0 | 1 | 2 | 3;
type TutorialStatus = "inactive" | "active" | "paused" | "complete";
interface TutorialState {
  status: TutorialStatus;
  step: TutorialStep;
  setupReady: boolean;
  start: (inGame: boolean) => void;
  pause: () => void;
  next: () => void;
  restartSetup: () => void;
  setSetupReady: (ready: boolean) => void;
  enterGame: () => void;
}
export const useTutorialStore = create<TutorialState>()(
  persist(
    (set) => ({
      status: "inactive",
      step: 0,
      setupReady: false,
      start: (inGame) =>
        set((state) => ({
          status: "active",
          step: inGame
            ? state.step >= 2 && state.status !== "complete"
              ? state.step
              : 2
            : state.status === "paused" || state.status === "active"
              ? state.step
              : 0,
        })),
      pause: () => set({ status: "paused" }),
      next: () =>
        set((state) =>
          state.status !== "active"
            ? {}
            : state.step === 3
              ? { status: "complete" }
              : { step: state.step === 0 ? 1 : state.step === 1 ? 2 : 3 },
        ),
      restartSetup: () => set({ step: 0, setupReady: false }),
      setSetupReady: (setupReady) => set({ setupReady }),
      enterGame: () =>
        set((state) => (state.status === "active" && state.step < 2 ? { step: 2 } : {})),
    }),
    {
      name: "manabrew-first-game-tutorial-v1",
      partialize: ({ status, step }) => ({ status, step }),
      merge: (persisted, current) => {
        if (!persisted || typeof persisted !== "object") return current;
        const saved = persisted as Record<string, unknown>;
        const step = saved.step;
        const status = saved.status;
        if (
          (step !== 0 && step !== 1 && step !== 2 && step !== 3) ||
          (status !== "inactive" &&
            status !== "active" &&
            status !== "paused" &&
            status !== "complete")
        )
          return current;
        return { ...current, step, status: status === "active" ? "paused" : status };
      },
    },
  ),
);
