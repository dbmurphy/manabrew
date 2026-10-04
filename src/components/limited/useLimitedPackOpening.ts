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
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [openAll, setOpenAll] = useState(false);
  const [arrival, setArrival] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [imageError, setImageError] = useState(false);
  const generation = useRef(0);
  const settle = useRef<{ packId: string; resolve: (completed: boolean) => void } | null>(null);
  const callback = useRef(onComplete);
  useLayoutEffect(() => {
    callback.current = onComplete;
  }, [onComplete]);
  const delivered = useRef<string | null>(null);
  const nextPack = packs.find((pack) => !openedIds.includes(pack.id));
  const activePack =
    packs.find((pack) => pack.id === reviewId) ?? packs.find((pack) => openedIds.includes(pack.id));
  const openedCount = packs.filter((pack) => openedIds.includes(pack.id)).length;
  const poolCards = useMemo(
    () => [
      ...(activePack?.cards ?? []),
      ...packs
        .filter((pack) => pack.id !== activePack?.id && openedIds.includes(pack.id))
        .flatMap((pack) => pack.cards),
    ],
    [activePack, packs, openedIds],
  );
  const openingCardIds = useMemo(() => activePack?.cards.map((card) => card.id), [activePack]);
  const cancel = useCallback(() => {
    generation.current += 1;
    settle.current?.resolve(false);
    settle.current = null;
  }, []);
  const finishReveal = useCallback(() => {
    const pending = settle.current;
    settle.current = null;
    setRevealing(false);
    if (pending) {
      open(sessionKey, [pending.packId]);
      pending.resolve(true);
    }
  }, [open, sessionKey]);
  const reveal = async (pack: SealedPool["packs"][number]): Promise<boolean> => {
    cancel();
    const current = generation.current;
    setPreparing(true);
    const results = await Promise.allSettled(
      pack.cards.map(async (card) => {
        const store = useScryfallStore.getState();
        const entry = await store.getCard({
          name: card.name,
          setCode: card.setCode,
          cardNumber: card.cardNumber,
        });
        const deckCard = refToDeckCard(card, entry);
        await store.getCardTexture(deckCard);
      }),
    );
    if (generation.current !== current) return false;
    setImageError(results.some((result) => result.status === "rejected"));
    setPreparing(false);
    setReviewId(pack.id);
    setArrival((value) => value + 1);
    setRevealing(true);
    return new Promise<boolean>((resolve) => {
      settle.current = { packId: pack.id, resolve };
    });
  };
  const openRemaining = async () => {
    setOpenAll(true);
    for (const pack of packs.filter((pack) => !openedIds.includes(pack.id))) {
      if (!(await reveal(pack))) return;
    }
    setOpenAll(false);
  };
  const review = (id: string) => {
    setReviewId(id);
    setRevealing(false);
  };
  const complete = () => {
    cancel();
    setPreparing(false);
    setOpenAll(false);
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
  useEffect(() => cancel, [cancel]);
  return {
    openedIds,
    openedCount,
    nextPack,
    activePack,
    preparing,
    revealing,
    poolCards,
    openingCardIds,
    openAll,
    imageError,
    arrival,
    reveal,
    finishReveal,
    openRemaining,
    review,
    complete,
  };
}
