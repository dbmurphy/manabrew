import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resources = join(root, "forge/forge-gui/res");
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: join(root, "forge"),
  encoding: "utf8",
}).trim();
const decks = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (entry.name.endsWith(".dck")) {
      const text = await readFile(path, "utf8");
      const name = text.match(/^Name=(.+)$/m)?.[1]?.trim() || entry.name.slice(0, -4);
      const deckPath = relative(resources, path).split("\\").join("/");
      decks.push([deckPath, name]);
    }
  }
}
await visit(resources);
decks.sort((a, b) => a[0].localeCompare(b[0], "en"));
await mkdir(join(root, "public/forge_decks"), { recursive: true });
await writeFile(
  join(root, "public/forge_decks/index.json"),
  JSON.stringify({ revision, decks }) + "\n",
);
console.log(`Indexed ${decks.length} Forge deck lists at ${revision}`);
