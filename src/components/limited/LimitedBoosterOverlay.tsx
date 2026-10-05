import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { LimitedBoosterControl } from "@/components/limited/LimitedBoosterControl";
import type { LimitedBoosterControlHandle } from "@/components/limited/LimitedBoosterControl";
import { Button } from "@/components/ui/button";
import type {
  BoosterOpeningState,
  BoosterTearDirection,
} from "@/pixi/limited/LimitedBoosterReveal";
import { cn } from "@/lib/utils";

interface LimitedBoosterOverlayProps {
  state: BoosterOpeningState | null;
  onOpen: () => void;
  onTear: (progress: number, direction?: BoosterTearDirection) => void;
  onSkip: () => void;
  onSkipOpening?: () => void;
}

export function LimitedBoosterOverlay({
  state,
  onOpen,
  onTear,
  onSkip,
  onSkipOpening,
}: LimitedBoosterOverlayProps) {
  const control = useRef<LimitedBoosterControlHandle>(null);
  const content = useRef<HTMLDivElement>(null);
  const [previousFocus] = useState(() => document.activeElement);
  const ready = state !== null;
  useEffect(() => {
    if (ready) control.current?.focus();
  }, [ready]);
  return (
    <DialogPrimitive.Root open modal>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-transparent" />
        <DialogPrimitive.Content
          ref={content}
          tabIndex={-1}
          className={cn(
            "fixed inset-0 z-[100] overflow-hidden bg-transparent outline-none",
            !ready && "bg-background",
          )}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (control.current) control.current.focus();
            else content.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
              previousFocus.focus();
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (state?.waiting) control.current?.reset();
            else if (state) onSkip();
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerMove={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <DialogPrimitive.Title className="sr-only">
            {state && state.packCount > 1 ? `Open all ${state.packCount} boosters` : "Open booster"}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {state && state.packCount > 1
              ? `Tap the grouped packets or drag their glowing seam to open all ${state.packCount} boosters together.`
              : "Drag horizontally across the glowing seam, or tap the packet to open it."}{" "}
            Arrow keys tear gradually. Enter or Space opens the focused packet. Escape resets an
            unfinished tear and can skip the animation only after opening.
          </DialogPrimitive.Description>
          {state ? (
            <LimitedBoosterControl ref={control} state={state} onOpen={onOpen} onTear={onTear} />
          ) : (
            <div
              role="status"
              className="flex h-full items-center justify-center px-6 text-center text-foreground"
            >
              Preparing your booster…
            </div>
          )}
          {onSkipOpening && (
            <div className="absolute inset-x-0 bottom-[calc(1.5rem+var(--safe-area-inset-bottom))] flex justify-center">
              <Button variant="outline" onClick={onSkipOpening}>
                Skip opening
              </Button>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
