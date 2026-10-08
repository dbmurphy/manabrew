import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { playGameSound, unlockGameSounds } from "@/lib/gameSounds";

export function GameSoundControls() {
  const prefs = usePreferencesStore();
  const id = useId();
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">Gameplay sounds</legend>
      <label className="flex min-h-11 items-center gap-2">
        <Checkbox
          checked={prefs.gameplaySounds}
          onCheckedChange={(value) => prefs.setGameplaySounds(value === true)}
        />
        Enable gameplay sounds
      </label>
      <p className="text-xs text-muted-foreground">
        Soft cues for card plays, turn changes and your next decision. Sounds start after you
        interact with the app, and are silent while the tab is hidden.
      </p>
      <div className="space-y-2">
        <label htmlFor={id} className="text-sm">
          Volume {Math.round(prefs.gameplaySoundVolume * 100)}%
        </label>
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(prefs.gameplaySoundVolume * 100)}
          disabled={!prefs.gameplaySounds}
          onChange={(event) => prefs.setGameplaySoundVolume(Number(event.target.value) / 100)}
          className="w-full accent-primary"
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <label className="flex min-h-11 items-center gap-2">
          <Checkbox
            checked={prefs.cardPlaySounds}
            disabled={!prefs.gameplaySounds}
            onCheckedChange={(value) => prefs.setCardPlaySounds(value === true)}
          />
          Card plays
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <Checkbox
            checked={prefs.turnSounds}
            disabled={!prefs.gameplaySounds}
            onCheckedChange={(value) => prefs.setTurnSounds(value === true)}
          />
          Turn changes
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <Checkbox
            checked={prefs.decisionSounds}
            disabled={!prefs.gameplaySounds}
            onCheckedChange={(value) => prefs.setDecisionSounds(value === true)}
          />
          Your decisions
        </label>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={!prefs.gameplaySounds}
        onClick={() => {
          void unlockGameSounds().then(() => playGameSound("cardPlay"));
        }}
      >
        Preview card-play sound
      </Button>
    </fieldset>
  );
}
