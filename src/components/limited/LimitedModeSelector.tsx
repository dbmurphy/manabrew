import { useId } from "react";
import { cn } from "@/lib/utils";
import type { LimitedSetupMode } from "@/components/limited/limitedSetup.types";

interface LimitedModeSelectorProps {
  mode: LimitedSetupMode;
  onChange: (mode: LimitedSetupMode) => void;
  disabled?: boolean;
}

const MODES: { value: LimitedSetupMode; title: string }[] = [
  { value: "sealed", title: "Sealed" },
  { value: "draft", title: "Booster Draft" },
  { value: "winston", title: "Winston" },
];

export function LimitedModeSelector({
  mode,
  onChange,
  disabled = false,
}: LimitedModeSelectorProps) {
  const groupId = useId();

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">Limited format</legend>
      <div className="flex flex-wrap gap-1">
        {MODES.map(({ value, title }) => (
          <label
            key={value}
            className={cn(
              "relative flex min-h-11 cursor-pointer items-center border-b-2 px-3 text-sm transition-colors focus-within:rounded-sm focus-within:ring-2 focus-within:ring-ring",
              mode === value
                ? "border-selection font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <input
              type="radio"
              name={groupId}
              value={value}
              checked={mode === value}
              onChange={() => onChange(value)}
              className="peer sr-only"
            />
            <span>{title}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
