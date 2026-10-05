import { useCallback, useEffect, useId, useImperativeHandle, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, Ref } from "react";
import type {
  BoosterOpeningState,
  BoosterTearDirection,
} from "@/pixi/limited/LimitedBoosterReveal";
import { LIMITED_DRAG_THRESHOLD } from "@/pixi/limited/limitedLayout";
import { LimitedBoosterGuide } from "@/components/limited/LimitedBoosterGuide";
import { haptic } from "@/lib/haptics";

export interface LimitedBoosterControlHandle {
  reset: () => void;
  focus: () => void;
}
interface LimitedBoosterControlProps {
  state: BoosterOpeningState;
  onOpen: () => void;
  onTear: (progress: number, direction?: BoosterTearDirection) => void;
  ref?: Ref<LimitedBoosterControlHandle>;
}
interface TearGesture {
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
  left: number;
  tearing: boolean;
  dragged: boolean;
  target: HTMLDivElement;
}

export function LimitedBoosterControl({ state, onOpen, onTear, ref }: LimitedBoosterControlProps) {
  const control = useRef<HTMLDivElement>(null);
  const gesture = useRef<TearGesture | null>(null);
  const tapPointer = useRef<number | null>(null);
  const opened = useRef(!state.waiting);
  const feedbackStep = useRef(0);
  const instructionsId = useId();
  const release = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    if (current?.target.hasPointerCapture(current.pointerId))
      current.target.releasePointerCapture(current.pointerId);
    return current;
  }, []);
  const reset = useCallback(() => {
    release();
    tapPointer.current = null;
    feedbackStep.current = 0;
    if (!opened.current && state.waiting) onTear(0);
  }, [onTear, release, state.waiting]);
  useImperativeHandle(ref, () => ({ reset, focus: () => control.current?.focus() }), [reset]);
  useEffect(() => {
    opened.current = !state.waiting;
  }, [state.waiting]);
  useEffect(() => {
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("blur", reset);
      release();
    };
  }, [release, reset]);
  const tear = (progress: number, direction: BoosterTearDirection) => {
    if (!state.waiting || opened.current) return;
    const step = Math.floor(progress * 4);
    if (step > feedbackStep.current && progress < 1) haptic("select");
    feedbackStep.current = Math.max(step, feedbackStep.current);
    if (progress === 1) {
      opened.current = true;
      tapPointer.current = null;
      haptic("confirm");
    }
    onTear(progress, direction);
  };
  const open = () => {
    if (!state.waiting || opened.current) return;
    release();
    tapPointer.current = null;
    opened.current = true;
    haptic("confirm");
    onOpen();
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId || opened.current) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (Math.hypot(dx, dy) >= LIMITED_DRAG_THRESHOLD) {
      current.dragged = true;
      tapPointer.current = null;
    }
    if (!current.dragged || !current.tearing) return;
    const distance =
      dx < 0 ? current.startX - current.left : current.left + current.width - current.startX;
    const progress =
      Math.abs(dx) >= Math.abs(dy)
        ? Math.min(1, Math.abs(dx) / Math.max(current.width * 0.5, distance))
        : 0;
    tear(progress, dx < 0 ? "left" : "right");
  };
  return (
    <>
      {state.waiting &&
        state.packetBounds?.map((bounds, index) => (
          <button
            key={index}
            type="button"
            tabIndex={-1}
            aria-label={`Open all ${state.packCount} boosters`}
            onClick={open}
            className="absolute cursor-pointer touch-none rounded-xl focus-visible:outline-2 focus-visible:outline-primary"
            style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
          />
        ))}
      <div
        ref={control}
        role="slider"
        tabIndex={state.waiting ? 0 : -1}
        aria-label="Booster seam"
        aria-describedby={instructionsId}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(state.progress * 100)}
        aria-valuetext={
          state.waiting
            ? `${Math.round(state.progress * 100)}% torn`
            : state.packCount > 1
              ? "Boosters opened"
              : "Booster opened"
        }
        aria-disabled={!state.waiting}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (
            !state.waiting ||
            opened.current ||
            !event.isPrimary ||
            event.button !== 0 ||
            gesture.current
          )
            return;
          const target = event.currentTarget;
          const bounds = target.getBoundingClientRect();
          feedbackStep.current = 0;
          tapPointer.current = event.pointerId;
          target.focus();
          target.setPointerCapture(event.pointerId);
          onTear(0);
          gesture.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            width: bounds.width,
            left: bounds.left,
            tearing: event.clientY < bounds.top + bounds.height * 0.38,
            dragged: false,
            target,
          };
        }}
        onPointerMove={move}
        onPointerUp={(event) => {
          if (gesture.current?.pointerId !== event.pointerId) return;
          move(event);
          const current = release();
          if (current?.dragged && !opened.current) reset();
        }}
        onPointerCancel={(event) => {
          if (gesture.current?.pointerId === event.pointerId) reset();
        }}
        onLostPointerCapture={(event) => {
          if (gesture.current?.pointerId === event.pointerId) reset();
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (gesture.current) return;
          if (event.detail !== 0) {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              tapPointer.current === null ||
              ("pointerId" in event.nativeEvent &&
                event.nativeEvent.pointerId !== tapPointer.current)
            )
              return;
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              return;
          }
          open();
        }}
        onKeyDown={(event) => {
          if (!state.waiting) return;
          if (event.key === "Home") {
            event.preventDefault();
            reset();
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            release();
            tapPointer.current = null;
            tear(
              Math.min(1, (Math.round(state.progress * 10) + 1) / 10),
              event.key === "ArrowLeft" ? "left" : "right",
            );
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
        }}
        className="absolute cursor-grab touch-none rounded-xl focus-visible:outline-2 focus-visible:outline-primary"
        style={{ left: state.x, top: state.y, width: state.width, height: state.height }}
      >
        {state.waiting && <LimitedBoosterGuide />}
      </div>
      <p
        hidden={!state.waiting}
        id={instructionsId}
        className="pointer-events-none absolute left-1/2 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-border bg-card/95 px-3 py-2 text-center text-xs font-medium text-card-foreground"
        style={{ top: Math.min(state.y + state.height + 12, window.innerHeight - 64) }}
      >
        {state.waiting ? "Drag across the glowing seam" : "Booster opened"}
        <span className="sr-only">
          . Tap a packet or press Enter or Space to open
          {state.packCount > 1 ? ` all ${state.packCount} boosters together` : " it"}. Arrow keys
          tear gradually. Home or Escape resets the tear.
        </span>
      </p>
    </>
  );
}
