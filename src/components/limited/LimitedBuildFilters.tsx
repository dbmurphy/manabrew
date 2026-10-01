import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import type { BuildGroup, BuildSession } from "@/components/limited/useLimitedBuildStore";
export interface BuildFilters {
  search: string;
  colors: string[];
  type: string;
}
interface Props {
  filters: BuildFilters;
  onChange: (filters: BuildFilters) => void;
  session: BuildSession;
  onPreferences: (prefs: Partial<Pick<BuildSession, "group" | "cardSize" | "mode">>) => void;
}
export function LimitedBuildFilters({ filters, onChange, session, onPreferences }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label="Search acquired pool"
        placeholder="Search your pool"
        value={filters.search}
        onChange={(event) => onChange({ ...filters, search: event.target.value })}
        className="h-9 min-w-40 flex-1"
      />
      <div className="flex gap-1" aria-label="Color filters">
        {["W", "U", "B", "R", "G", "C", "M"].map((color) => (
          <Button
            key={color}
            variant={filters.colors.includes(color) ? "selected" : "outline"}
            size="sm"
            aria-label={`Filter ${color === "M" ? "multicolor" : color === "C" ? "colorless" : color}`}
            aria-pressed={filters.colors.includes(color)}
            onClick={() =>
              onChange({
                ...filters,
                colors: filters.colors.includes(color)
                  ? filters.colors.filter((item) => item !== color)
                  : [...filters.colors, color],
              })
            }
          >
            {color === "M" ? "Multi" : <ManaSymbols cost={`{${color}}`} size="sm" />}
          </Button>
        ))}
      </div>
      <AppSelect
        aria-label="Card type filter"
        value={filters.type}
        onValueChange={(type) => onChange({ ...filters, type })}
        className="h-9"
      >
        <AppSelectOption value="all">All types</AppSelectOption>
        {[
          "Creature",
          "Land",
          "Instant",
          "Sorcery",
          "Artifact",
          "Enchantment",
          "Planeswalker",
          "Conspiracy",
        ].map((type) => (
          <AppSelectOption key={type} value={type}>
            {type}
          </AppSelectOption>
        ))}
      </AppSelect>
      <AppSelect
        aria-label="Group cards"
        value={session.group}
        onValueChange={(group) => onPreferences({ group: group as BuildGroup })}
        className="h-9"
      >
        <AppSelectOption value="none">No grouping</AppSelectOption>
        <AppSelectOption value="color">Color</AppSelectOption>
        <AppSelectOption value="cmc">Mana value</AppSelectOption>
        <AppSelectOption value="type">Type</AppSelectOption>
        <AppSelectOption value="rarity">Rarity</AppSelectOption>
      </AppSelect>
      <AppSelect
        aria-label="Card size"
        value={String(session.cardSize)}
        onValueChange={(size) => onPreferences({ cardSize: Number(size) })}
        className="h-9"
      >
        <AppSelectOption value="90">Small</AppSelectOption>
        <AppSelectOption value="130">Medium</AppSelectOption>
        <AppSelectOption value="170">Large</AppSelectOption>
      </AppSelect>
      <Button
        variant={session.mode === "gallery" ? "selected" : "outline"}
        size="sm"
        aria-pressed={session.mode === "gallery"}
        onClick={() => onPreferences({ mode: "gallery" })}
      >
        Gallery
      </Button>
      <Button
        variant={session.mode === "list" ? "selected" : "outline"}
        size="sm"
        aria-pressed={session.mode === "list"}
        onClick={() => onPreferences({ mode: "list" })}
      >
        List
      </Button>
      {(filters.search || filters.colors.length || filters.type !== "all") && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ search: "", colors: [], type: "all" })}
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}
