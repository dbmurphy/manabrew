import { useCallback, useEffect, useId, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  BoosterOpeningState,
  BoosterTearDirection,
} from "@/pixi/limited/LimitedBoosterReveal";
import { LIMITED_DRAG_THRESHOLD } from "@/pixi/limited/limitedLayout";
import { haptic } from "@/lib/haptics";

interface LimitedBoosterControlProps {
  state: BoosterOpeningState;
  onOpen: () => void;
  onTear: (progress: number, direction?: BoosterTearDirection) => void;
  onSkip: () => void;
}
interface TearGesture {
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
  left: number;
  tearing: boolean;
  feedbackStep: number;
  dragged: boolean;
  opened: boolean;
  target: HTMLButtonElement;
}

export function LimitedBoosterControl({
  state,
  onOpen,
  onTear,
  onSkip,
}: LimitedBoosterControlProps) {
  const gesture = useRef<TearGesture | null>(null);
  const suppressClick = useRef(false);
  const clickPointer = useRef<number | null>(null);
  const instructionsId = useId();
  const release = useCallback(() => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    if (current.target.hasPointerCapture(current.pointerId))
      current.target.releasePointerCapture(current.pointerId);
    return current;
  }, []);
  const cancel = useCallback(() => {
    const current = release();
    if (!current) return;
    suppressClick.current = true;
    if (!current.opened) onTear(0);
  }, [onTear, release]);
  useEffect(() => {
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      release();
    };
  }, [cancel, release]);
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId || current.opened) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (Math.hypot(dx, dy) >= LIMITED_DRAG_THRESHOLD) current.dragged = true;
    if (!current.dragged) return;
    suppressClick.current = true;
    if (!current.tearing) return;
    const distance =
      dx < 0 ? current.startX - current.left : current.left + current.width - current.startX;
    const progress = Math.min(1, Math.abs(dx) / Math.max(current.width * 0.5, distance));
    const feedbackStep = Math.floor(progress * 4);
    if (feedbackStep > current.feedbackStep && progress < 1) haptic("select");
    current.feedbackStep = Math.max(current.feedbackStep, feedbackStep);
    onTear(progress, dx < 0 ? "left" : "right");
    if (progress === 1) {
      current.opened = true;
      haptic("confirm");
      onOpen();
    }
  };
  return (
    <>
      <p id={instructionsId} className="sr-only">
        Tap or press Enter or Space to open. Drag horizontally across the wrapper seam to tear it.
        Press Escape to skip the opening.
      </p>
      <button
        type="button"
        aria-label={state.waiting ? "Open booster" : "Skip opening animation"}
        aria-describedby={instructionsId}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (!event.isPrimary || event.button !== 0 || gesture.current) return;
          suppressClick.current = false;
          clickPointer.current = event.pointerId;
          if (!state.waiting) return;
          const target = event.currentTarget;
          const bounds = target.getBoundingClientRect();
          target.setPointerCapture(event.pointerId);
          gesture.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            width: bounds.width,
            left: bounds.left,
            tearing: event.clientY < bounds.top + bounds.height * 0.38,
            feedbackStep: 0,
            dragged: false,
            opened: false,
            target,
          };
        }}
        onPointerMove={move}
        onPointerUp={(event) => {
          if (gesture.current?.pointerId !== event.pointerId) return;
          move(event);
          const current = release();
          if (current?.tearing && current.dragged && !current.opened) onTear(0);
        }}
        onPointerCancel={(event) => {
          if (gesture.current?.pointerId === event.pointerId) cancel();
        }}
        onLostPointerCapture={(event) => {
          if (gesture.current?.pointerId === event.pointerId) cancel();
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (
            gesture.current ||
            (event.detail !== 0 &&
              "pointerId" in event.nativeEvent &&
              event.nativeEvent.pointerId !== clickPointer.current)
          )
            return;
          if (event.detail !== 0 && suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          cancel();
          if (state.waiting) {
            haptic("confirm");
            onOpen();
          } else onSkip();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          cancel();
          onSkip();
        }}
        className="pointer-events-auto absolute z-[3] cursor-pointer touch-none rounded-xl focus-visible:outline-2 focus-visible:outline-primary"
        style={{ left: state.x, top: state.y, width: state.width, height: state.height }}
      >
        <span className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-card/90 px-3 py-1 text-xs font-medium text-card-foreground">
          {state.waiting ? "Drag the top or tap to open" : "Skip opening animation"}
        </span>
      </button>
    </>
  );
}
