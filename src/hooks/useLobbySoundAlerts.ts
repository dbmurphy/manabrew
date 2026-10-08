import { useCallback, useEffect, useRef } from "react";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { RoomInfo } from "@/types/server";

function playAlert(context: AudioContext, ready: boolean) {
  if (context.state !== "running") return;
  const start = context.currentTime;
  for (const [index, frequency] of (ready ? [660, 880] : [440, 660]).entries()) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const time = start + index * 0.13;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.08, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(time);
    oscillator.stop(time + 0.13);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
}

export function useLobbySoundAlerts(room: RoomInfo, username: string | null) {
  const enabled = usePreferencesStore((state) => state.lobbySoundAlerts);
  const context = useRef<AudioContext | null>(null);
  const previous = useRef<RoomInfo | null>(null);
  const unlock = useCallback(() => {
    if (!context.current && typeof AudioContext !== "undefined") {
      context.current = new AudioContext();
    }
    const audio = context.current;
    if (audio?.state === "suspended") void audio.resume().catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, [enabled, unlock]);

  useEffect(() => {
    const old = previous.current;
    previous.current = room;
    if (
      !enabled ||
      !old ||
      old.room_id !== room.room_id ||
      room.status !== "Lobby" ||
      old.status !== "Lobby"
    )
      return;
    const others = room.players.filter((player) => player.username !== username && !player.is_bot);
    const joined = others.some(
      (player) => !old.players.some((prior) => prior.username === player.username),
    );
    const ready = others.some(
      (player) =>
        player.ready &&
        old.players.some((prior) => prior.username === player.username && !prior.ready),
    );
    if ((joined || ready) && context.current) playAlert(context.current, ready);
  }, [room, username, enabled]);

  useEffect(
    () => () => {
      if (context.current) void context.current.close().catch(() => {});
      context.current = null;
    },
    [],
  );

  const setEnabled = useCallback(
    (value: boolean) => {
      if (value) unlock();
      usePreferencesStore.getState().setLobbySoundAlerts(value);
    },
    [unlock],
  );
  return { enabled, setEnabled };
}
