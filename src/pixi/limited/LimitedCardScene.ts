import { Container, Graphics, Sprite, Text } from "pixi.js";
import { getTheme, subscribeTheme } from "@/hooks/useTheme";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { hexToNum } from "@/pixi/colorUtils";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { LongPressGesture } from "@/pixi/LongPressGesture";
import {
  acquireLimitedRenderer,
  type LimitedPane,
  type LimitedRenderer,
} from "@/pixi/limited/LimitedRenderer";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { LimitedBoosterReveal } from "@/pixi/limited/LimitedBoosterReveal";
import {
  LIMITED_DRAG_THRESHOLD,
  type LimitedCell,
  type LimitedLayout,
} from "@/pixi/limited/limitedLayout";
import type { DraftCard } from "@/types/limited";

export interface LimitedSceneProps {
  layout: LimitedLayout;
  width: number;
  height: number;
  scrollTop: number;
  selectedIds: readonly string[];
  disabled: boolean;
  arrivalKey?: string;
  opening: boolean;
  onSelect?: (card: DraftCard, additive: boolean) => void;
  onActivate?: (card: DraftCard) => void;
  onDrop?: (card: DraftCard, clientX: number, clientY: number) => void;
  onInspect: (card: DraftCard | null, sticky: boolean) => void;
}
interface CardEntry {
  cell: LimitedCell;
  root: Container;
  motion: Container;
  image: Sprite;
  frame: Graphics;
  label: Text;
  locale: string;
  loading: boolean;
}
interface Drag {
  pointerId: number;
  entry: CardEntry;
  startX: number;
  startY: number;
  active: boolean;
  pointerType: string;
  additive: boolean;
  target: EventTarget | null;
}

export class LimitedCardScene implements LimitedPane {
  readonly root = new Container();
  private readonly entries = new Map<string, CardEntry>();
  private readonly headings = new Container();
  private readonly longPress = new LongPressGesture();
  private readonly renderer: LimitedRenderer;
  private readonly reveal: LimitedBoosterReveal;
  private unsubscribeTheme: (() => void) | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private initialized = false;
  private disposed = false;
  private arrivalKey: string | undefined;
  private drag: Drag | null = null;
  private lastTap: { id: string; time: number } | null = null;
  readonly host: HTMLElement;
  private props: LimitedSceneProps;
  private readonly onError: (error: string) => void;
  constructor(host: HTMLElement, props: LimitedSceneProps, onError: (error: string) => void) {
    this.host = host;
    this.props = props;
    this.onError = onError;
    this.root.eventMode = "none";
    this.root.sortableChildren = true;
    this.root.addChild(this.headings);
    this.reveal = new LimitedBoosterReveal(this.root, this.request);
    this.renderer = acquireLimitedRenderer(this);
  }
  async init(): Promise<void> {
    try {
      await this.renderer.ready;
      if (this.disposed) return;
      this.initialized = true;
      this.unsubscribeTheme = subscribeTheme(() => this.update(this.props));
      this.unsubscribeStore = useScryfallStore.subscribe((state, previous) => {
        if (state.locale !== previous.locale) this.update(this.props);
      });
      window.addEventListener("pointermove", this.move);
      window.addEventListener("pointerup", this.release);
      window.addEventListener("pointercancel", this.cancelPointer);
      window.addEventListener("blur", this.abort);
      this.update(this.props);
    } catch (error) {
      if (!this.disposed) this.onError(error instanceof Error ? error.message : String(error));
    }
  }
  readonly frame = (): boolean => {
    if (!animationsEnabled() && this.reveal.active) this.reveal.finish();
    return this.reveal.active;
  };
  update(props: LimitedSceneProps): void {
    const scrollChanged = this.props.scrollTop !== props.scrollTop;
    this.props = props;
    if (!this.initialized || this.disposed) return;
    if (props.disabled || scrollChanged) this.abort();
    const visible = props.layout.cells.filter(
      (cell) =>
        cell.y + cell.height >= props.scrollTop - cell.height &&
        cell.y <= props.scrollTop + props.height + cell.height,
    );
    const visibleIds = new Set(visible.map(({ card }) => card.id));
    const newArrival = props.arrivalKey !== this.arrivalKey;
    if (newArrival) this.reveal.finish();
    for (const [id, entry] of this.entries) {
      if (visibleIds.has(id)) continue;
      if (this.drag?.entry === entry) this.abort();
      entry.root.removeFromParent();
      entry.root.destroy({ children: true });
      this.entries.delete(id);
    }
    const theme = getTheme();
    for (const cell of visible) {
      let entry = this.entries.get(cell.card.id);
      if (!entry) {
        const root = new Container();
        const motion = new Container();
        const image = new Sprite();
        const frame = new Graphics();
        const label = new Text({
          text: cell.card.name,
          style: {
            fontFamily: "Alegreya Sans",
            fontSize: 13,
            fill: theme.appTheme.foreground,
            wordWrap: true,
            wordWrapWidth: cell.width - 12,
          },
        });
        root.addChild(motion);
        motion.addChild(frame, image, label);
        this.root.addChild(root);
        entry = { cell, root, motion, image, frame, label, locale: "", loading: false };
        this.entries.set(cell.card.id, entry);
      }
      entry.cell = cell;
      entry.root.position.set(cell.x, cell.y - props.scrollTop);
      entry.image.width = cell.width;
      entry.image.height = cell.height;
      entry.label.style.fill = theme.appTheme.foreground;
      entry.label.style.wordWrapWidth = cell.width - 12;
      entry.label.position.set(6, cell.height / 2 - entry.label.height / 2);
      const selected = props.selectedIds.includes(cell.card.id);
      entry.frame
        .clear()
        .roundRect(0, 0, cell.width, cell.height, 6)
        .fill(hexToNum(theme.appTheme.muted))
        .stroke({
          color: hexToNum(selected ? theme.gameTheme.cardSelection : theme.appTheme.border),
          width: selected ? 4 : 1,
        });
      entry.image.alpha = props.disabled ? 0.65 : 1;
      if (entry.locale !== useScryfallStore.getState().locale && !entry.loading)
        void this.load(entry);
    }
    for (const child of this.headings.removeChildren()) child.destroy();
    for (const header of props.layout.headers) {
      if (header.y < props.scrollTop - 32 || header.y > props.scrollTop + props.height) continue;
      const text = new Text({
        text: header.label,
        style: {
          fontFamily: "Alegreya Sans",
          fontSize: 16,
          fontWeight: "bold",
          fill: theme.appTheme["muted-foreground"],
        },
      });
      text.position.set(16, header.y - props.scrollTop);
      this.headings.addChild(text);
    }
    if (newArrival) {
      this.arrivalKey = props.arrivalKey;
      if (props.opening)
        this.reveal.play(
          visible.map((cell) => ({
            motion: this.entries.get(cell.card.id)!.motion,
            ...cell,
            y: cell.y - props.scrollTop,
          })),
          props.width,
          props.height,
        );
    }
    if (!props.opening) this.reveal.finish();
    this.request();
  }
  private async load(entry: CardEntry): Promise<void> {
    entry.loading = true;
    const locale = useScryfallStore.getState().locale;
    entry.locale = locale;
    try {
      const { info, uris } = await useScryfallStore.getState().getCard({
        name: entry.cell.card.name,
        setCode: entry.cell.card.setCode,
        collectorNumber: entry.cell.card.cardNumber,
      });
      const deckCard = scryfallToDeckCard({ ...info, image_uris: info.image_uris ?? uris });
      deckCard.identity = { ...deckCard.identity, ...entry.cell.card };
      const texture = await useScryfallStore.getState().getCardTexture(deckCard, "full", 0);
      if (this.disposed || entry.root.destroyed || locale !== useScryfallStore.getState().locale)
        return;
      entry.image.texture = texture;
      entry.image.width = entry.cell.width;
      entry.image.height = entry.cell.height;
      entry.label.visible = texture.width <= 1;
    } catch {
      if (!entry.root.destroyed) entry.label.text = `${entry.cell.card.name}\nImage unavailable`;
    } finally {
      entry.loading = false;
      this.request();
      if (!this.disposed && !entry.root.destroyed && locale !== useScryfallStore.getState().locale)
        void this.load(entry);
    }
  }
  pressCard(id: string, event: PointerEvent): void {
    const entry = this.entries.get(id);
    if (!entry || this.props.disabled || this.drag || event.button !== 0 || this.reveal.active)
      return;
    this.longPress.reset();
    this.drag = {
      pointerId: event.pointerId,
      entry,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      pointerType: event.pointerType,
      additive: event.ctrlKey || event.metaKey || event.shiftKey,
      target: event.target,
    };
    this.longPress.start(
      { pointerType: event.pointerType, global: { x: event.clientX, y: event.clientY } },
      entry.cell.card.id,
      () => this.props.onInspect(entry.cell.card, true),
    );
  }
  hoverCard(id: string | null, pointerType: string): void {
    if (pointerType !== "mouse" || this.drag || this.reveal.active) return;
    const card = id ? this.entries.get(id)?.cell.card : null;
    if (card || !id) this.props.onInspect(card ?? null, false);
  }
  inspectCard(id: string): void {
    const card = this.props.layout.cells.find((cell) => cell.card.id === id)?.card;
    if (card) {
      this.abort();
      this.props.onInspect(card, true);
    }
  }
  private readonly move = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.longPress.move(event.clientX, event.clientY);
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (
      drag.pointerType === "touch" &&
      !drag.active &&
      Math.abs(dy) > Math.abs(dx) &&
      Math.abs(dy) > LIMITED_DRAG_THRESHOLD
    ) {
      this.abort();
      return;
    }
    if (!drag.active && this.props.onDrop && Math.hypot(dx, dy) > LIMITED_DRAG_THRESHOLD) {
      drag.active = true;
      this.longPress.cancel();
      drag.entry.root.zIndex = 1;
    }
    if (!drag.active) return;
    drag.entry.motion.position.set(dx / this.root.scale.x, dy / this.root.scale.y);
    drag.entry.motion.alpha = 0.85;
    this.request();
  };
  private readonly release = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const held = this.longPress.consumeTap(drag.entry.cell.card.id);
    this.abort();
    if (held || this.props.disabled) return;
    if (drag.active) {
      if (
        event.clientX >= 0 &&
        event.clientY >= 0 &&
        event.clientX < window.innerWidth &&
        event.clientY < window.innerHeight &&
        document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-limited-zone]")
      )
        this.props.onDrop?.(drag.entry.cell.card, event.clientX, event.clientY);
      return;
    }
    if (event.target !== drag.target) return;
    const now = performance.now();
    if (
      this.lastTap?.id === drag.entry.cell.card.id &&
      now - this.lastTap.time < 350 &&
      this.props.onActivate
    ) {
      this.props.onActivate(drag.entry.cell.card);
      this.lastTap = null;
    } else {
      this.props.onSelect?.(drag.entry.cell.card, drag.additive);
      this.lastTap = { id: drag.entry.cell.card.id, time: now };
    }
  };
  private readonly cancelPointer = (event: PointerEvent): void => {
    if (event.pointerId === this.drag?.pointerId) this.abort();
  };
  readonly abort = (): void => {
    this.longPress.reset();
    if (this.drag && !this.drag.entry.root.destroyed) {
      this.drag.entry.motion.position.set(0, 0);
      this.drag.entry.motion.alpha = 1;
      this.drag.entry.root.zIndex = 0;
    }
    this.drag = null;
    this.request();
  };
  private readonly request = (): void => {
    this.renderer?.request();
  };
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort();
    this.reveal.finish();
    this.unsubscribeTheme?.();
    this.unsubscribeStore?.();
    window.removeEventListener("pointermove", this.move);
    window.removeEventListener("pointerup", this.release);
    window.removeEventListener("pointercancel", this.cancelPointer);
    window.removeEventListener("blur", this.abort);
    this.renderer.release(this);
    this.root.destroy({ children: true });
    this.entries.clear();
  }
}
