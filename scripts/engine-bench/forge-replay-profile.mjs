#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createForgeEngine, createReplayForgeEngine } from "../../packages/forge-wasm/node.js";
import { comparable, replayScenario } from "./replay-scenario.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const launcher = resolve(option("launcher", join(root, "packages/forge-wasm/forgeharness.js")));
const browserName = option("browser");
const runs = Number(option("runs", "3"));
const storedTrace = option("trace")
  ? JSON.parse(readFileSync(resolve(option("trace")), "utf8"))
  : null;
const config = {
  fixture: option("fixture", "token"),
  seed: Number(option("seed", "42")),
  seats: Number(option("seats", "2")),
  turns: Number(option("turns", "10")),
  ...storedTrace?.config,
  trace: storedTrace,
  restore: process.argv.includes("--restore"),
};
assert.ok(Number.isInteger(runs) && runs >= 1 && runs <= 30);
assert.ok(Number.isInteger(config.seats) && config.seats >= 2 && config.seats <= 4);
assert.ok(Number.isInteger(config.turns) && config.turns >= 3 && config.turns <= 50);
assert.ok(!browserName || ["chrome", "firefox"].includes(browserName));
const hash = createHash("sha256");
for await (const chunk of createReadStream(`${launcher}.wasm`)) hash.update(chunk);
const engineSha256 = hash.digest("hex");
let browser, server;
const deadline = setTimeout(
  () => {
    console.error("Profile timed out");
    process.exit(1);
  },
  20 * 60 * 1000,
);
try {
  let page;
  if (option("record-trace")) {
    assert.ok(
      !browserName && !storedTrace,
      "Record a Node trace separately from browser profiling",
    );
    const names = option(
      "presets",
      "kaalia_regression_commander,starter_deck_animar,real_teval_commander,neheb_minotaur_commander",
    ).split(",");
    config.gameDecks = names.map((name) => {
      const raw = JSON.parse(
        readFileSync(join(root, "public/preset_decks", `${name}.json`), "utf8"),
      );
      const commanders = [raw.commander, raw.signatureSpell].filter(Boolean);
      const card = (entry) => ({
        name: entry.name,
        setCode: entry.set,
        cardNumber: entry.cardNumber,
        count: entry.count ?? 1,
      });
      return {
        name: raw.label,
        format: raw.format,
        commanders: commanders.map((name) => ({
          ...card(raw.cards.find((entry) => entry.name === name)),
          count: 1,
        })),
        cards: raw.cards.flatMap((entry) => {
          const value = card(entry);
          if (commanders.includes(entry.name)) value.count--;
          return value.count > 0 ? [value] : [];
        }),
      };
    });
    config.seats = names.length;
    config.fixture = "custom";
    assert.ok(config.seats >= 2 && config.seats <= 4);
    const module = await import(pathToFileURL(resolve(option("manabot-js"))));
    const log = console.log;
    try {
      console.log = (...args) => console.error(...args);
      await module.default({ module_or_path: readFileSync(resolve(option("manabot-wasm"))) });
    } finally {
      console.log = log;
    }
    const bots = new Map(),
      history = [];
    try {
      const recorded = await replayScenario(
        (callbacks) =>
          createForgeEngine({ ...callbacks, launcherUrl: launcher, wasmUrl: `${launcher}.wasm` }),
        {
          ...config,
          mode: "disabled",
          restore: false,
          decide(frame) {
            const slot = frame.slot ?? "local";
            if (!bots.has(slot)) bots.set(slot, new module.WasmManabot());
            const bot = bots.get(slot);
            bot.observe_frame(JSON.stringify({ kind: "state", state: frame.state }));
            const action = JSON.parse(
              bot.answer_frame(JSON.stringify({ kind: "prompt", prompt: frame.prompt })),
            ).action;
            history.push({ frame: comparable(frame), action });
            return action;
          },
        },
      );
      const { trace: _trace, restore: _restore, ...traceConfig } = config;
      config.trace = { config: traceConfig, history, finalState: recorded.finalState };
      writeFileSync(resolve(option("record-trace")), JSON.stringify(config.trace));
      console.error(`Recorded ${history.length} Manabot inputs`);
    } finally {
      for (const bot of bots.values()) bot.free();
    }
  }
  if (browserName) {
    server = createServer(async (req, res) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      try {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname === "/") {
          res.setHeader("Content-Type", "text/html");
          res.end("<!doctype html><title>Forge replay profile</title>");
          return;
        }
        if (url.search === "?url") {
          res.setHeader("Content-Type", "text/javascript");
          res.end(`export default ${JSON.stringify(url.pathname)};`);
          return;
        }
        let path;
        if (url.pathname === "/packages/forge-wasm/forgeharness.js") path = launcher;
        else if (url.pathname === "/packages/forge-wasm/forgeharness.js.wasm")
          path = `${launcher}.wasm`;
        else {
          path = resolve(root, `.${url.pathname}`);
          if (
            !path.startsWith(`${root}/packages/forge-wasm/`) &&
            !path.startsWith(`${root}/scripts/engine-bench/`)
          )
            throw new Error("Unknown path");
        }
        res.setHeader(
          "Content-Type",
          extname(path) === ".wasm" ? "application/wasm" : "text/javascript",
        );
        res.setHeader("Content-Length", (await stat(path)).size);
        createReadStream(path)
          .on("error", () => res.destroy())
          .pipe(res);
      } catch {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { chromium, firefox } = await import("playwright");
    browser =
      browserName === "firefox"
        ? await firefox.launch()
        : await chromium.launch({ channel: "chrome" });
  }
  const openPage = async () => {
    page = await browser.newPage();
    if (browserName === "chrome") {
      const session = await browser.newBrowserCDPSession();
      await page.exposeFunction("readProcessCpu", async () => {
        const { processInfo } = await session.send("SystemInfo.getProcessInfo");
        return {
          user: processInfo.reduce((sum, process) => sum + process.cpuTime * 1e6, 0),
          system: 0,
        };
      });
    }
    page.on("pageerror", (error) => console.error(error));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.evaluate(() => crossOriginIsolated), true);
    if (process.argv.includes("--timer-fallback"))
      await page.evaluate(() => {
        Atomics.waitAsync = undefined;
      });
  };

  let baseline;
  const modes = option("mode") ? [option("mode")] : ["snapshots", "disabled", "replay"];
  assert.ok(modes.every((mode) => ["snapshots", "disabled", "replay"].includes(mode)));
  for (let run = 0; run < runs; run++) {
    for (const mode of [
      ...modes.slice(run % modes.length),
      ...modes.slice(0, run % modes.length),
    ]) {
      if (browser) await openPage();
      const scenario = { ...config, mode, restore: config.restore && mode === "replay" };
      const cpu = process.cpuUsage();
      const result = page
        ? await page.evaluate(async (options) => {
            const { createForgeEngine, createReplayForgeEngine } =
              await import("/packages/forge-wasm/forge.js");
            const { replayScenario } = await import("/scripts/engine-bench/replay-scenario.mjs");
            return replayScenario(
              options.mode === "replay" ? createReplayForgeEngine : createForgeEngine,
              { ...options, measureCpu: globalThis.readProcessCpu },
            );
          }, scenario)
        : await replayScenario(
            (callbacks) =>
              (mode === "replay" ? createReplayForgeEngine : createForgeEngine)({
                ...callbacks,
                launcherUrl: launcher,
                wasmUrl: `${launcher}.wasm`,
              }),
            { ...scenario, measureCpu: () => process.cpuUsage() },
          );
      const used = process.cpuUsage(cpu);
      await page?.close();
      const { actions, finalState, ...metrics } = result;
      const opening = actions
        .filter((action) => JSON.parse(action).action.type === "diceRolled")
        .sort();
      const decisions = actions.filter((action) => JSON.parse(action).action.type !== "diceRolled");
      const trace = { actions: [...opening, ...decisions], finalState };
      baseline ??= trace;
      assert.deepEqual(trace, baseline);
      console.log(
        JSON.stringify({
          runtime: browserName ?? "node",
          runtimeVersion: browser?.version() ?? process.version,
          engineSha256,
          run,
          ...metrics,
          cpuWithBootMs: page ? null : (used.user + used.system) / 1000,
        }),
      );
    }
  }
} finally {
  clearTimeout(deadline);
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
