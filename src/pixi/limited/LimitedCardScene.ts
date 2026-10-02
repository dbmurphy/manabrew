import { Container, Graphics, Sprite, Text } from "pixi.js";
import { getTheme, subscribeTheme } from "@/hooks/useTheme";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { hexToNum } from "@/pixi/colorUtils";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";
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
  arrivalDirection?: "left" | "right";
  acquiredIds?: readonly string[];
  departureTarget?: () => HTMLElement | null;
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
  pose: Container;
  image: Sprite;
  frame: Graphics;
  label: Text;
  locale: string;
  loading: boolean;
  layoutTimeline: gsap.core.Timeline | null;
  motionTimeline: gsap.core.Timeline | null;
  poseTimeline: gsap.core.Timeline | null;
  poseLift: number;
  poseRotation: number;
  poseScale: number;
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
const DEAL_DURATION = 0.38;
const DEAL_STAGGER = 0.025;
const DEAL_STAGGER_LIMIT = 0.18;
const REFLOW_DURATION = 0.24;
const POSE_DURATION = 0.16;
const POOL_SETTLE_DELAY = 0.28;
const POOL_SETTLE_DURATION = 0.26;
const HOVER_LIFT = 9;
const SELECTED_LIFT = 4;
const HOVER_TILT = -0.025;
const HOVER_SCALE = 1.035;
const SELECTED_SCALE = 1.015;

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
  private knownIds = new Set<string>();
  private acquiredIds = new Set<string>();
  private readonly acceptedIds = new Set<string>();
  private hasLayout = false;
  private hoveredId: string | null = null;
  private revealing = false;
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
    if (!animationsEnabled()) this.finishAnimations();
    if (this.revealing && !this.reveal.active) {
      for (const entry of this.entries.values()) this.updatePose(entry);
    }
    this.revealing = this.reveal.active;
    if (this.reveal.active) return true;
    for (const entry of this.entries.values()) {
      if (entry.layoutTimeline || entry.motionTimeline || entry.poseTimeline) return true;
    }
    return false;
  };
  update(props: LimitedSceneProps): void {
    const scrollChanged = this.props.scrollTop !== props.scrollTop;
    this.props = props;
    if (!this.initialized || this.disposed) return;
    const allIds = new Set(props.layout.cells.map(({ card }) => card.id));
    const acquiredIds = new Set(props.acquiredIds);
    for (const id of acquiredIds) {
      if (!this.acquiredIds.has(id) && this.knownIds.has(id)) this.acceptedIds.add(id);
    }
    const addedIds = this.hasLayout
      ? new Set(
          props.acquiredIds
            ? props.acquiredIds.filter((id) => !this.acquiredIds.has(id))
            : props.layout.cells
                .filter(({ card }) => !this.knownIds.has(card.id))
                .map(({ card }) => card.id),
        )
      : new Set<string>();
    const visible = props.layout.cells.filter(
      (cell) =>
        cell.y + cell.height >= props.scrollTop - cell.height &&
        cell.y <= props.scrollTop + props.height + cell.height,
    );
    const visibleIds = new Set(visible.map(({ card }) => card.id));
    const newArrival = props.arrivalKey !== this.arrivalKey;
    const freshDeal =
      newArrival &&
      (!this.hasLayout || !props.layout.cells.some(({ card }) => this.knownIds.has(card.id)));
    const layoutChanged = visible.some((cell) => {
      const previous = this.entries.get(cell.card.id)?.cell;
      return previous && this.cellChanged(previous, cell);
    });
    if (newArrival || scrollChanged || !props.opening || layoutChanged) this.reveal.finish();
    if (props.disabled || scrollChanged) this.abort();
    if (!animationsEnabled()) this.finishAnimations();
    for (const [id, entry] of this.entries) {
      if (visibleIds.has(id)) continue;
      if (
        !allIds.has(id) &&
        acquiredIds.has(id) &&
        this.acceptedIds.has(id) &&
        props.departureTarget
      )
        this.renderer.flyCard(this, entry.image, props.departureTarget);
      if (this.drag?.entry === entry) this.abort();
      this.killEntry(entry);
      entry.root.removeFromParent();
      entry.root.destroy({ children: true });
      this.entries.delete(id);
      if (this.hoveredId === id) this.hoveredId = null;
    }
    const theme = getTheme();
    for (const [index, cell] of visible.entries()) {
      let entry = this.entries.get(cell.card.id);
      const created = !entry;
      if (!entry) {
        const root = new Container();
        const motion = new Container();
        const pose = new Container();
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
        motion.addChild(pose);
        pose.addChild(frame, image, label);
        this.root.addChild(root);
        entry = {
          cell,
          root,
          motion,
          pose,
          image,
          frame,
          label,
          locale: "",
          loading: false,
          layoutTimeline: null,
          motionTimeline: null,
          poseTimeline: null,
          poseLift: 0,
          poseRotation: 0,
          poseScale: 1,
        };
        this.entries.set(cell.card.id, entry);
      }
      if (newArrival || scrollChanged) this.finishEntry(entry);
      this.placeEntry(
        entry,
        cell,
        created || scrollChanged || freshDeal || (newArrival && props.opening),
      );
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
      if (!props.opening && freshDeal && props.arrivalKey) this.deal(entry, index);
      else if (!props.opening && !props.arrivalKey && created && addedIds.has(cell.card.id))
        this.settle(entry, index);
      this.updatePose(entry);
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
      text.position.set(header.x, header.y - props.scrollTop);
      this.headings.addChild(text);
    }
    if (newArrival) {
      this.arrivalKey = props.arrivalKey;
      if (props.opening) {
        for (const entry of this.entries.values()) this.finishEntry(entry);
        this.reveal.play(
          visible.map((cell) => ({
            motion: this.entries.get(cell.card.id)!.motion,
            ...cell,
            y: cell.y - props.scrollTop,
          })),
          props.width,
          props.height,
        );
        for (const entry of this.entries.values()) this.updatePose(entry, false);
      }
      this.revealing = this.reveal.active;
    }
    this.knownIds = allIds;
    this.acquiredIds = acquiredIds;
    for (const id of this.acceptedIds) {
      if (!allIds.has(id) || !acquiredIds.has(id)) this.acceptedIds.delete(id);
    }
    this.hasLayout = true;
    this.request();
  }
  private cellChanged(previous: LimitedCell, cell: LimitedCell): boolean {
    return (
      previous.x !== cell.x ||
      previous.y !== cell.y ||
      previous.width !== cell.width ||
      previous.height !== cell.height
    );
  }
  private placeEntry(entry: CardEntry, cell: LimitedCell, snap: boolean): void {
    const previous = entry.cell;
    const changed = this.cellChanged(previous, cell);
    entry.cell = cell;
    if (changed || snap) {
      entry.pose.pivot.set(cell.width / 2, cell.height / 2);
      entry.pose.x = cell.width / 2;
      this.updatePose(entry, false);
    }
    if (!snap && !changed) return;
    entry.layoutTimeline?.kill();
    entry.layoutTimeline = null;
    if (snap || !animationsEnabled() || this.drag?.entry === entry || this.reveal.active) {
      entry.root.position.set(cell.x, cell.y - this.props.scrollTop);
      entry.root.scale.set(1);
      return;
    }
    entry.root.scale.set(
      (entry.root.scale.x * previous.width) / cell.width,
      (entry.root.scale.y * previous.height) / cell.height,
    );
    const timeline = gsap.timeline({
      onUpdate: this.request,
      onComplete: () => {
        entry.layoutTimeline = null;
        this.request();
      },
    });
    entry.layoutTimeline = timeline;
    timeline.to(entry.root, {
      x: cell.x,
      y: cell.y - this.props.scrollTop,
      duration: REFLOW_DURATION,
      ease: "power2.out",
    });
    timeline.to(entry.root.scale, { x: 1, y: 1, duration: REFLOW_DURATION, ease: "power2.out" }, 0);
  }
  private deal(entry: CardEntry, index: number): void {
    if (!animationsEnabled()) return;
    const direction = this.props.arrivalDirection === "left" ? -1 : 1;
    entry.motion.position.set(
      direction * Math.min(this.props.width * 0.42, entry.cell.width * 2),
      -entry.cell.height * 0.09,
    );
    entry.motion.rotation = direction * 0.04;
    entry.motion.scale.set(0.96);
    entry.motion.alpha = 0;
    this.arrive(entry, DEAL_DURATION, Math.min(index * DEAL_STAGGER, DEAL_STAGGER_LIMIT));
  }
  private settle(entry: CardEntry, index: number): void {
    if (!animationsEnabled()) return;
    entry.motion.position.set(0, -Math.min(entry.cell.height * 0.18, 30));
    entry.motion.scale.set(0.94);
    entry.motion.rotation = -0.025;
    entry.motion.alpha = 0;
    this.arrive(
      entry,
      POOL_SETTLE_DURATION,
      POOL_SETTLE_DELAY + Math.min(index * DEAL_STAGGER, DEAL_STAGGER_LIMIT),
    );
  }
  private arrive(entry: CardEntry, duration: number, delay: number): void {
    entry.motionTimeline?.kill();
    const timeline = gsap.timeline({
      onUpdate: this.request,
      onComplete: () => {
        entry.motionTimeline = null;
        this.request();
      },
    });
    entry.motionTimeline = timeline;
    timeline.to(
      entry.motion,
      { x: 0, y: 0, rotation: 0, alpha: 1, duration, ease: "power3.out" },
      delay,
    );
    timeline.to(entry.motion.scale, { x: 1, y: 1, duration, ease: "power3.out" }, delay);
  }
  private updatePose(entry: CardEntry, animate = true): void {
    const interactive = !this.props.disabled && !this.reveal.active && this.drag?.entry !== entry;
    const hovered = interactive && this.hoveredId === entry.cell.card.id;
    const selected = interactive && this.props.selectedIds.includes(entry.cell.card.id);
    const lift = hovered ? HOVER_LIFT : selected ? SELECTED_LIFT : 0;
    const rotation = hovered ? HOVER_TILT : 0;
    const scale = hovered ? HOVER_SCALE : selected ? SELECTED_SCALE : 1;
    entry.root.zIndex =
      this.drag?.entry === entry && this.drag.active ? 3 : hovered ? 2 : selected ? 1 : 0;
    if (
      animate &&
      animationsEnabled() &&
      entry.poseLift === lift &&
      entry.poseRotation === rotation &&
      entry.poseScale === scale
    )
      return;
    entry.poseTimeline?.kill();
    entry.poseTimeline = null;
    entry.poseLift = lift;
    entry.poseRotation = rotation;
    entry.poseScale = scale;
    const y = entry.cell.height / 2 - lift;
    if (!animate || !animationsEnabled()) {
      entry.pose.y = y;
      entry.pose.rotation = rotation;
      entry.pose.scale.set(scale);
      return;
    }
    const timeline = gsap.timeline({
      onUpdate: this.request,
      onComplete: () => {
        entry.poseTimeline = null;
        this.request();
      },
    });
    entry.poseTimeline = timeline;
    timeline.to(entry.pose, { y, rotation, duration: POSE_DURATION, ease: "power2.out" });
    timeline.to(
      entry.pose.scale,
      { x: scale, y: scale, duration: POSE_DURATION, ease: "power2.out" },
      0,
    );
  }
  private killEntry(entry: CardEntry): void {
    entry.layoutTimeline?.kill();
    entry.motionTimeline?.kill();
    entry.poseTimeline?.kill();
    entry.layoutTimeline = null;
    entry.motionTimeline = null;
    entry.poseTimeline = null;
  }
  private finishEntry(entry: CardEntry): void {
    this.killEntry(entry);
    entry.root.position.set(entry.cell.x, entry.cell.y - this.props.scrollTop);
    entry.root.scale.set(1);
    if (this.drag?.entry !== entry || !this.drag.active) {
      entry.motion.position.set(0, 0);
      entry.motion.scale.set(1);
      entry.motion.rotation = 0;
      entry.motion.alpha = 1;
    }
    this.updatePose(entry, false);
  }
  private finishAnimations(): void {
    if (this.reveal.active) this.reveal.finish();
    for (const entry of this.entries.values()) {
      if (entry.layoutTimeline || entry.motionTimeline || entry.poseTimeline)
        this.finishEntry(entry);
    }
    this.renderer.cancelFlights(this);
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
    this.finishEntry(entry);
    this.longPress.start(
      { pointerType: event.pointerType, global: { x: event.clientX, y: event.clientY } },
      entry.cell.card.id,
      () => this.props.onInspect(entry.cell.card, true),
    );
  }
  hoverCard(id: string | null, pointerType: string): void {
    if (pointerType !== "mouse" || this.drag || this.reveal.active) return;
    const previous = this.hoveredId ? this.entries.get(this.hoveredId) : null;
    const entry = id ? this.entries.get(id) : null;
    this.hoveredId = entry?.cell.card.id ?? null;
    if (previous && previous !== entry) this.updatePose(previous);
    if (entry) this.updatePose(entry);
    if (entry || !id) this.props.onInspect(entry?.cell.card ?? null, false);
    this.request();
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
      this.finishEntry(drag.entry);
      drag.entry.root.zIndex = 3;
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
    const entry = this.drag?.entry;
    this.drag = null;
    if (entry && !entry.root.destroyed) this.finishEntry(entry);
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
    for (const entry of this.entries.values()) this.killEntry(entry);
    this.unsubscribeTheme?.();
    this.unsubscribeStore?.();
    window.removeEventListener("pointermove", this.move);
    window.removeEventListener("pointerup", this.release);
    window.removeEventListener("pointercancel", this.cancelPointer);
    window.removeEventListener("blur", this.abort);
    this.renderer.release(this);
    this.root.destroy({ children: true });
    this.entries.clear();
    this.knownIds.clear();
    this.acquiredIds.clear();
    this.acceptedIds.clear();
  }
}
