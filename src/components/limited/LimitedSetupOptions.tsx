import { useId } from "react";
import { Input } from "@/components/ui/input";
import type { LimitedSetupMode } from "@/components/limited/limitedSetup.types";

interface LimitedSetupOptionsProps {
  mode: LimitedSetupMode;
  numBoosters: number;
  onNumBoostersChange: (n: number) => void;
  podSize: number;
  onPodSizeChange: (n: number) => void;
  winstonPacks: number;
  onWinstonPacksChange: (n: number) => void;
  seed: string;
  onSeedChange: (s: string) => void;
  picksPerPass: number;
  onPicksPerPassChange: (n: number) => void;
  disabled?: boolean;
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}

function NumberField({ id, label, value, min, max, onChange }: NumberFieldProps) {
  return (
    <label htmlFor={id} className="flex flex-col gap-2 text-sm font-medium text-foreground">
      {label}
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          onChange(Number.isFinite(next) ? Math.max(min, Math.min(max, Math.trunc(next))) : min);
        }}
        className="w-full sm:w-32"
      />
    </label>
  );
}

export function LimitedSetupOptions({
  mode,
  numBoosters,
  onNumBoostersChange,
  podSize,
  onPodSizeChange,
  winstonPacks,
  onWinstonPacksChange,
  seed,
  onSeedChange,
  picksPerPass,
  onPicksPerPassChange,
  disabled = false,
}: LimitedSetupOptionsProps) {
  const id = useId();

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-4">
      <legend className="sr-only">Mode settings</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        {mode === "sealed" && (
          <NumberField
            id={`${id}-sealed-packs`}
            label="Packs"
            value={numBoosters}
            min={3}
            max={12}
            onChange={onNumBoostersChange}
          />
        )}
        {mode === "draft" && (
          <NumberField
            id={`${id}-pod-size`}
            label="Players"
            value={podSize}
            min={2}
            max={8}
            onChange={onPodSizeChange}
          />
        )}
        {mode === "winston" && (
          <NumberField
            id={`${id}-winston-packs`}
            label="Packs"
            value={winstonPacks}
            min={2}
            max={12}
            onChange={onWinstonPacksChange}
          />
        )}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor={`${id}-seed`} className="block text-sm font-medium text-foreground">
            Seed
          </label>
          <Input
            id={`${id}-seed`}
            type="text"
            inputMode="numeric"
            value={seed}
            onChange={(event) => onSeedChange(event.currentTarget.value)}
            placeholder="Random"
            className="font-mono"
          />
        </div>
        {mode === "draft" && (
          <div className="space-y-2">
            <NumberField
              id={`${id}-picks`}
              label="Picks per pass"
              value={picksPerPass}
              min={1}
              max={4}
              onChange={onPicksPerPassChange}
            />
          </div>
        )}
      </div>
    </fieldset>
  );
}
