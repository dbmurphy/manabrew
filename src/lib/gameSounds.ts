import { usePreferencesStore } from "@/stores/usePreferencesStore";

export type GameSoundGroup = "cardPlay" | "turn" | "decision";
const FREQUENCIES: Record<GameSoundGroup, number> = { cardPlay: 620, turn: 440, decision: 780 };
let context: AudioContext | null = null;
const activeNodes = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();
const lastPlayed = new Map<GameSoundGroup, number>();

export async function unlockGameSounds(): Promise<void> {
  if (!usePreferencesStore.getState().gameplaySounds || typeof AudioContext === "undefined") return;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") await context.resume();
  } catch {
    closeGameSounds();
  }
}

export function closeGameSounds(): void {
  for (const { oscillator, gain } of activeNodes) {
    oscillator.onended = null;
    try {
      oscillator.stop();
    } catch {
      oscillator.onended = null;
    }
    oscillator.disconnect();
    gain.disconnect();
  }
  activeNodes.clear();
  lastPlayed.clear();
  if (context) void context.close().catch(() => {});
  context = null;
}

export function playGameSound(group: GameSoundGroup): void {
  const prefs = usePreferencesStore.getState();
  const enabled =
    group === "cardPlay"
      ? prefs.cardPlaySounds
      : group === "turn"
        ? prefs.turnSounds
        : prefs.decisionSounds;
  if (
    !prefs.gameplaySounds ||
    !enabled ||
    !context ||
    context.state !== "running" ||
    document.hidden ||
    prefs.gameplaySoundVolume === 0
  )
    return;
  const now = performance.now();
  if (now - (lastPlayed.get(group) ?? -Infinity) < 150) return;
  lastPlayed.set(group, now);
  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const nodes = { oscillator, gain };
    activeNodes.add(nodes);
    const at = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(FREQUENCIES[group], at);
    oscillator.frequency.exponentialRampToValueAtTime(FREQUENCIES[group] * 0.85, at + 0.12);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.08 * prefs.gameplaySoundVolume, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      activeNodes.delete(nodes);
    };
    oscillator.start(at);
    oscillator.stop(at + 0.15);
  } catch {
    closeGameSounds();
  }
}
