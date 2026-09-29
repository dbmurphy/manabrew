// Spike: a full offline game in the real client, with the browser engine built to seat the human
// on Forge's PlayerControllerHuman (ForgeHumanGui). Records which prompt kinds reached the client.
//
//   BASE=http://localhost:5199 node tests/e2e-ui/forge-human-spike.mjs
import { chromium } from "playwright";
import { launchOpts, onboard, uniqueName } from "../e2e-ironsmith/lib.mjs";
import { answerPrompt, startSoloGame, waitForFirstPrompt } from "./forgeSolo.mjs";

const BASE = process.env.BASE || "http://localhost:5199";
const FORMAT = process.env.FORMAT || "Pioneer";
const DECK = process.env.DECK || "Izzet Creativity";
const AI_DECK = process.env.AI_DECK || "Red Deck Wins";
const BUDGET_MS = Number(process.env.BUDGET_MS || 400000);
const AI = process.env.AI || "manabot";

const browser = await chromium.launch(launchOpts());
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
let pageError = null;
page.on("pageerror", (e) => (pageError = String(e).slice(0, 200)));

async function fail(msg) {
  const log = await page.evaluate(() => (window.__forgeLog || []).slice(-15)).catch(() => []);
  for (const line of log) console.log("   engine:", String(line).slice(0, 200));
  console.log(`FAIL: ${msg}${pageError ? ` (pageerror: ${pageError})` : ""}`);
  await browser.close();
  process.exit(1);
}

await page.addInitScript((ai) => {
  try {
    const raw = localStorage.getItem("manabrew-preferences");
    const doc = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    doc.state = { ...(doc.state || {}), forgeWasmEnabled: true, aiController: ai };
    localStorage.setItem("manabrew-preferences", JSON.stringify(doc));
  } catch {
    // fresh origin
  }
}, AI);

await onboard(page, uniqueName("Human"));
await page.goto(`${BASE}/play/offline/constructed`, { waitUntil: "networkidle" });
await startSoloGame(page, { format: FORMAT, decks: [DECK, AI_DECK], pod: process.env.POD === "1", fail });
await waitForFirstPrompt(page).catch(() => fail("no first prompt"));

const kinds = {};
const first = [];
const t0 = Date.now();
let over = false;
let lastPayCard = null;
while (Date.now() - t0 < BUDGET_MS) {
  // Like the JVM greedy driver: a second payment prompt for the same card means auto-pay stalled, so cancel
  const repeatPay = await page.evaluate((last) => {
    const s = window.__gameStore.getState();
    const input = s.currentPrompt?.input;
    if (!input || s.isWaitingForResponse || input.type !== "payManaCost") return null;
    if (input.cardId === last) {
      void s.respond({ type: "cancel" });
      return "cancel";
    }
    return input.cardId;
  }, lastPayCard);
  if (repeatPay === "cancel") {
    lastPayCard = null;
    kinds.payManaCostCancel = (kinds.payManaCostCancel || 0) + 1;
    await page.waitForTimeout(40);
    continue;
  }
  if (repeatPay) lastPayCard = repeatPay;
  const type = await answerPrompt(page, { playLands: true });
  if (type === "gameOver") {
    over = true;
    break;
  }
  if (type) {
    kinds[type] = (kinds[type] || 0) + 1;
    if (first.length < 6) first.push(type);
  }
  await page.waitForTimeout(type ? 40 : 250);
}
const state = await page.evaluate(() => {
  const s = window.__gameStore.getState();
  return { turn: s.gameView?.turn, lives: (s.gameView?.players || []).map((p) => p.life), winner: s.gameView?.winnerId };
});
const log = await page.evaluate(() => (window.__forgeLog || []).filter((l) => /forge-human|Exception|Error/.test(l)).slice(-20));
console.log("first prompts:", first.join(", "));
console.log("prompt kinds:", JSON.stringify(kinds));
console.log("state:", JSON.stringify(state), "seconds:", Math.round((Date.now() - t0) / 1000));
for (const l of log.filter((l) => !/\[forge-human\] (input|answered|dialog)/.test(l))) console.log("   engine:", String(l).slice(0, 200));
const seats = await page.evaluate(() => {
  const out = {};
  for (const l of window.__forgeLog || []) {
    const m = /\[forge-human\] input (\w+).*prompt=Priority: ([^T]+?) Turn/.exec(l);
    if (m) out[m[2].trim()] = (out[m[2].trim()] || 0) + 1;
  }
  return out;
});
// CRASHLOG: anything the engine said about crashing or game over
console.log("engine tail:", JSON.stringify(await page.evaluate(() => (window.__forgeLog || []).filter((l) => !/\[forge-human\] (input|answered|dialog)/.test(l)).slice(-12)), null, 1).slice(0, 2500));
console.log(`ai=${AI} adapter priority prompts by seat:`, JSON.stringify(seats));
const crashed = await page.evaluate(() => (window.__forgeLog || []).some((l) => /engine crashed/.test(l)));
if (crashed) {
  const why = await page.evaluate(() => (window.__forgeLog || []).filter((l) => /Exception|never finished|forge-human\] (input|dialog)/.test(l)).slice(-30));
  for (const l of why) console.log("   crash:", String(l).slice(0, 260));
  await fail("the engine crashed; the game over was the crash report");
}
if (!over) {
  const dbg = await page.evaluate(() => {
    const s = window.__gameStore.getState();
    return {
      frames: (window.__forgeFrames || []).slice(-12),
      waiting: s.isWaitingForResponse,
      prompt: s.currentPrompt?.input?.type ?? null,
      tail: (window.__forgeLog || []).filter((l) => /forge-human|Exception|at /.test(l)).slice(-25),
    };
  });
  console.log("debug:", JSON.stringify(dbg, null, 1).slice(0, 3000));
  await fail("game did not end within budget");
}
console.log(`PASS: full game on the forge-human browser engine${pageError ? ` (pageerror: ${pageError})` : ""}`);
await browser.close();
