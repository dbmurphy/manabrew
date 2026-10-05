import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLimitedOpeningStore } from "@/components/limited/limitedOpeningStore";
import { refToDeckCard } from "@/lib/limited.utils";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { SealedPool } from "@/types/limited";

const NO_OPENED_PACKS: string[] = [];

export function useLimitedPackOpening(
  sessionKey: string,
  packs: SealedPool["packs"],
  onComplete: () => void,
) {
  const saved = useLimitedOpeningStore((state) => state.sessions[sessionKey]);
  const open = useLimitedOpeningStore((state) => state.open);
  const openedIds = saved?.openedIds ?? NO_OPENED_PACKS;
  const [selectedPackIds, setSelectedPackIds] = useState<string[]>([]);
  const [revealing, setRevealing] = useState(false);
  const [arrival, setArrival] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [imageError, setImageError] = useState(false);
  const generation = useRef(0);
  const pendingReveal = useRef<{ generation: number; packIds: string[] } | null>(null);
  const callback = useRef(onComplete);
  useLayoutEffect(() => {
    callback.current = onComplete;
  }, [onComplete]);
  const delivered = useRef<string | null>(null);
  const nextPack = packs.find((pack) => !openedIds.includes(pack.id));
  const activePacks = useMemo(
    () =>
      selectedPackIds.length > 0
        ? packs.filter((pack) => selectedPackIds.includes(pack.id))
        : packs.filter((pack) => openedIds.includes(pack.id)).slice(0, 1),
    [packs, selectedPackIds, openedIds],
  );
  const activePack = activePacks.length === 1 ? activePacks[0] : undefined;
  const openedCount = packs.filter((pack) => openedIds.includes(pack.id)).length;
  const poolCards = useMemo(
    () => [
      ...activePacks.flatMap((pack) => pack.cards),
      ...packs
        .filter(
          (pack) =>
            openedIds.includes(pack.id) && !activePacks.some((active) => active.id === pack.id),
        )
        .flatMap((pack) => pack.cards),
    ],
    [activePacks, packs, openedIds],
  );
  const openingCardIds = useMemo(
    () => activePacks.flatMap((pack) => pack.cards.map((card) => card.id)),
    [activePacks],
  );
  const openingPackCount = activePacks.length || 1;
  const openingSetCode = activePacks.every((pack) => pack.setCode === activePacks[0]?.setCode)
    ? activePacks[0]?.setCode
    : undefined;
  const cancel = useCallback(() => {
    generation.current += 1;
    pendingReveal.current = null;
  }, []);
  const finishReveal = useCallback(() => {
    const pending = pendingReveal.current;
    if (!pending || pending.generation !== generation.current) return;
    pendingReveal.current = null;
    setRevealing(false);
    open(sessionKey, pending.packIds);
  }, [open, sessionKey]);
  const revealPacks = async (remainingPacks: SealedPool["packs"]) => {
    if (remainingPacks.length === 0) return;
    cancel();
    const current = generation.current;
    setRevealing(false);
    setPreparing(true);
    setImageError(false);
    const results = await Promise.allSettled(
      remainingPacks.flatMap((pack) =>
        pack.cards.map(async (card) => {
          const store = useScryfallStore.getState();
          const entry = await store.getCard({
            name: card.name,
            setCode: card.setCode,
            cardNumber: card.cardNumber,
          });
          if (generation.current !== current) return;
          const deckCard = refToDeckCard(card, entry);
          await store.getCardTexture(deckCard);
        }),
      ),
    );
    if (generation.current !== current) return;
    const packIds = remainingPacks.map((pack) => pack.id);
    pendingReveal.current = { generation: current, packIds };
    setImageError(results.some((result) => result.status === "rejected"));
    setPreparing(false);
    setSelectedPackIds(packIds);
    setArrival((value) => value + 1);
    setRevealing(true);
  };
  const reveal = (pack: SealedPool["packs"][number]) => revealPacks([pack]);
  const openRemaining = () => revealPacks(packs.filter((pack) => !openedIds.includes(pack.id)));
  const review = (id: string) => {
    cancel();
    setPreparing(false);
    setSelectedPackIds([id]);
    setRevealing(false);
  };
  const complete = () => {
    cancel();
    setPreparing(false);
    setRevealing(false);
    open(
      sessionKey,
      packs.map((pack) => pack.id),
      true,
    );
  };
  useEffect(() => {
    if (saved?.completed && delivered.current !== sessionKey) {
      delivered.current = sessionKey;
      callback.current();
    }
  }, [saved?.completed, sessionKey]);
  useLayoutEffect(() => cancel, [cancel, sessionKey]);
  return {
    openedIds,
    openedCount,
    nextPack,
    activePack,
    preparing,
    revealing,
    poolCards,
    openingCardIds,
    openingPackCount,
    openingSetCode,
    imageError,
    arrival,
    reveal,
    finishReveal,
    openRemaining,
    review,
    complete,
  };
}
