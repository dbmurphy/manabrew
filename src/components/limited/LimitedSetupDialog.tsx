import { Button } from "@/components/ui/button";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LimitedSetupOptions } from "@/components/limited/LimitedSetupOptions";
import { LimitedSetupExtras } from "@/components/limited/LimitedSetupExtras";
import { cn } from "@/lib/utils";
import type { RefObject } from "react";
import type { useLimitedSetup } from "@/components/limited/useLimitedSetup";
import type { useLimitedSetSelection } from "@/components/limited/useLimitedSetSelection";
import type { LimitedSetupPanel } from "@/components/limited/limitedSetup.types";

interface LimitedSetupDialogProps {
  panel: LimitedSetupPanel | null;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  setup: ReturnType<typeof useLimitedSetup>;
  selection: ReturnType<typeof useLimitedSetSelection>;
}

export function LimitedSetupDialog({
  panel,
  onClose,
  triggerRef,
  setup,
  selection,
}: LimitedSetupDialogProps) {
  const modeTitle =
    setup.mode === "sealed" ? "Sealed" : setup.mode === "draft" ? "Booster Draft" : "Winston";
  const title =
    panel === "customize"
      ? `Customize ${modeTitle}`
      : panel === "templates"
        ? "Sealed templates"
        : "Themed Chaos Draft";
  const variants = selection.loading
    ? []
    : [...new Set(selection.info?.variants.filter((variant) => variant.trim()) ?? [])];
  return (
    <Dialog
      open={panel !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className={cn("w-[calc(100%-2rem)]", panel === "customize" ? "max-w-lg" : "max-w-3xl")}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!setup.pendingDraftStart) triggerRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {panel === "customize"
              ? "Settings apply immediately and stay selected when you close this panel."
              : "Additional Limited options."}
          </DialogDescription>
        </DialogHeader>
        {panel === "customize" && (
          <div className="space-y-5">
            <LimitedSetupOptions
              mode={setup.mode}
              numBoosters={setup.numBoosters}
              onNumBoostersChange={setup.setNumBoosters}
              podSize={setup.podSize}
              onPodSizeChange={setup.setPodSize}
              winstonPacks={setup.winstonPacks}
              onWinstonPacksChange={setup.setWinstonPacks}
              seed={setup.seed}
              onSeedChange={setup.setSeed}
              picksPerPass={setup.picksPerPass}
              onPicksPerPassChange={setup.setPicksPerPass}
              pickSeconds={setup.pickSeconds}
              onPickSecondsChange={setup.setPickSeconds}
              disabled={setup.busy}
            />
            {setup.source === "set" && variants.length > 0 && (
              <div className="space-y-2">
                <span id="limited-variant-label" className="block text-sm font-medium">
                  Booster variant
                </span>
                <AppSelect
                  aria-labelledby="limited-variant-label"
                  value={selection.selectedVariant}
                  onValueChange={selection.onVariantChange}
                  disabled={setup.busy}
                  className="w-full"
                >
                  <AppSelectOption value="">Default</AppSelectOption>
                  {variants.map((variant) => (
                    <AppSelectOption key={variant} value={variant}>
                      {variant}
                    </AppSelectOption>
                  ))}
                </AppSelect>
              </div>
            )}
            <details className="text-sm text-muted-foreground">
              <summary className="w-fit cursor-pointer underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Help
              </summary>
              <div className="mt-3 space-y-2">
                <p>
                  Seed is an optional nonnegative integer for repeatable packs with the same
                  settings. Leave blank for random.
                </p>
                {setup.mode === "sealed" && <p>Your opponent opens a separate pool.</p>}
                {setup.mode === "draft" && (
                  <p>
                    Players includes you and the AI seats. Picks per pass controls how many cards
                    you take before passing a pack.
                  </p>
                )}
                {setup.mode === "winston" && (
                  <p>Take turns choosing from three shared piles against one AI opponent.</p>
                )}
              </div>
            </details>
          </div>
        )}
        {(panel === "templates" || panel === "chaos") && (
          <LimitedSetupExtras
            section={panel}
            sets={selection.sets}
            podSize={setup.podSize}
            busy={setup.busy}
            onStartChaos={(codes) => {
              onClose();
              setup.startChaos(codes);
            }}
          />
        )}
        {setup.lastError && (
          <p role="alert" className="text-sm text-destructive">
            {setup.lastError}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
