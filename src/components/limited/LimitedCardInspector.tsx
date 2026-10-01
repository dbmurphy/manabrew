import { useEffect, useState } from "react";
import { CardPreview } from "@/components/game/CardPreview";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { deckCardToPreviewDto, scryfallToDeckCard } from "@/lib/scryfall.utils";
import { useCard, useScryfallStore } from "@/stores/useScryfallStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { DraftCard } from "@/types/limited";

export interface LimitedInspection {
  card: DraftCard;
  sticky: boolean;
}
export function LimitedCardInspector({
  inspection,
  onClose,
  onEnter,
  onLeave,
}: {
  inspection: LimitedInspection;
  onClose: () => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const preference = usePreferencesStore((state) => state.inGameCardPreviewStyle);
  const [mode, setMode] = useState(preference);
  const [face, setFace] = useState<0 | 1>(0);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const entry = useCard({
    name: inspection.card.name,
    setCode: inspection.card.setCode,
    collectorNumber: inspection.card.cardNumber,
  });
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void useScryfallStore
      .getState()
      .getCard({
        name: inspection.card.name,
        setCode: inspection.card.setCode,
        collectorNumber: inspection.card.cardNumber,
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [inspection.card.name, inspection.card.setCode, inspection.card.cardNumber]);
  const info = entry?.info;
  const activeFace = info?.card_faces?.[face];
  const name =
    activeFace?.printed_name ?? activeFace?.name ?? info?.printed_name ?? inspection.card.name;
  const flippable = !!info?.card_faces?.[1]?.image_uris;
  const ruleFaces =
    !flippable && info?.card_faces?.length ? info.card_faces : info ? [activeFace ?? info] : [];
  const deckCard =
    info && entry?.uris
      ? scryfallToDeckCard({ ...info, image_uris: info.image_uris ?? entry.uris })
      : null;
  if (deckCard) deckCard.identity = { ...deckCard.identity, ...inspection.card };
  const body = (
    <div onMouseEnter={onEnter} onMouseLeave={onLeave} className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={mode === "printed" ? "selected" : "outline"}
          size="sm"
          onClick={() => setMode("printed")}
        >
          Printed
        </Button>
        <Button
          variant={mode === "rules" ? "selected" : "outline"}
          size="sm"
          onClick={() => setMode("rules")}
        >
          Rules
        </Button>
        {flippable && (
          <Button variant="outline" size="sm" onClick={() => setFace(face === 0 ? 1 : 0)}>
            Other face
          </Button>
        )}
        {!inspection.sticky && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
      {!info && (
        <p className="text-sm text-muted-foreground">
          {error ? "Card details unavailable. Check your connection." : "Loading card details…"}
        </p>
      )}
      {mode === "printed" && deckCard && (
        <div ref={setSlot} className="relative h-[min(55vh,420px)] min-h-48 w-full">
          {slot && (
            <CardPreview
              card={deckCardToPreviewDto(deckCard)}
              mouseX={0}
              mouseY={0}
              slot={slot}
              showBackFace={face === 1}
              skipEnterAnimation
            />
          )}
        </div>
      )}
      {mode === "rules" && info && (
        <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-border bg-background p-4">
          {ruleFaces.map((ruleFace, index) => (
            <section key={index} className="mb-4 last:mb-0">
              <h3 className="font-serif text-2xl">{ruleFace.printed_name ?? ruleFace.name}</h3>
              <DynamicTextRender text={ruleFace.mana_cost ?? ""} />
              <p className="my-3 border-y border-border py-2 text-sm">
                {ruleFace.printed_type_line ?? ruleFace.type_line}
              </p>
              <div className="whitespace-pre-wrap text-base">
                <DynamicTextRender text={ruleFace.printed_text ?? ruleFace.oracle_text ?? ""} />
              </div>
              {ruleFace.power != null && (
                <p className="mt-3 text-right font-semibold">
                  {ruleFace.power}/{ruleFace.toughness}
                </p>
              )}
              {ruleFace.loyalty != null && <p className="mt-3">Loyalty {ruleFace.loyalty}</p>}
              {ruleFace.defense != null && <p className="mt-3">Defense {ruleFace.defense}</p>}
            </section>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {inspection.card.setCode.toUpperCase()} · {inspection.card.cardNumber}
        {inspection.card.foil ? " · Foil" : ""}
      </p>
    </div>
  );
  if (inspection.sticky)
    return (
      <Modal onClose={onClose} maxWidth="max-w-md">
        <Modal.Header>
          <h2 className="font-serif text-xl">{name}</h2>
        </Modal.Header>
        <Modal.Body>{body}</Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
    );
  return (
    <aside
      aria-label={`Inspect ${name}`}
      data-card-preview
      className="fixed right-4 top-24 z-[10001] w-[min(340px,calc(100vw-32px))] rounded-xl border border-border bg-card p-4 text-card-foreground shadow-xl"
    >
      {body}
    </aside>
  );
}
