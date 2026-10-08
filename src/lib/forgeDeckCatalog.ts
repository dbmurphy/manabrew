export interface ForgeDeckCatalog {
  revision: string;
  decks: Array<[path: string, name: string]>;
}

export async function fetchForgeDeckCatalog(signal: AbortSignal): Promise<ForgeDeckCatalog> {
  const response = await fetch("/forge_decks/index.json", { signal });
  if (!response.ok) throw new Error(`Deck catalog failed to load (${response.status})`);
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    !("revision" in data) ||
    typeof data.revision !== "string" ||
    !/^[a-f0-9]{40}$/.test(data.revision) ||
    !("decks" in data) ||
    !Array.isArray(data.decks) ||
    !data.decks.every(
      (entry: unknown) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        entry.every((value: unknown) => typeof value === "string") &&
        !entry[0].split("/").includes(".."),
    )
  ) {
    throw new Error("Invalid Forge deck catalog");
  }
  return data as ForgeDeckCatalog;
}

export async function fetchForgeDeckList(
  catalog: ForgeDeckCatalog,
  path: string,
  signal: AbortSignal,
): Promise<string> {
  const url = `https://raw.githubusercontent.com/witchesofthehill/forge/${catalog.revision}/forge-gui/res/${path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Deck list failed to load (${response.status})`);
  return convertForgeDeckList(await response.text());
}

export function convertForgeDeckList(source: string): string {
  let section = "metadata";
  const lines: string[] = [];
  const ignored = new Set(["metadata", "duel", "quest", "shop"]);
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";") || line.startsWith("//")) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1].toLowerCase();
      if (section === "main" || section === "sideboard" || section === "commander")
        lines.push(section);
      continue;
    }
    if (ignored.has(section)) continue;
    if (!["main", "sideboard", "commander"].includes(section))
      throw new Error(`This list uses ${section} cards, which the text importer cannot place yet.`);
    const card = line.match(/^(?:(\d+)\s+)?([^|]+)(?:\|.*)?$/);
    if (!card || !Number.isSafeInteger(Number(card[1] ?? 1)) || Number(card[1] ?? 1) < 1)
      throw new Error(`Unrecognized Forge card line: ${line}`);
    lines.push(`${card[1] ?? 1} ${card[2].trim().replace(/\+$/, "")}`);
  }
  if (!lines.some((line) => /^\d+ /.test(line)))
    throw new Error("This list contains no importable cards.");
  return lines.join("\n");
}
