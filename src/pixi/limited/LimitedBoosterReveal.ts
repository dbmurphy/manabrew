import { Container, FillGradient, Graphics, Sprite, Text } from "pixi.js";
import { gsap } from "@/pixi/effects/gsap";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { getTheme } from "@/hooks/useTheme";
import { hexToNum } from "@/pixi/colorUtils";
import { setSymbolTexture } from "@/pixi/cardPreview/setSymbolCache";
import type { ScryfallSet } from "@/types/scryfall";

export interface RevealCard {
  motion: Container;
  x: number;
  y: number;
  width: number;
  height: number;
}
export type BoosterTearDirection = "left" | "right";
export interface BoosterOpeningState {
  x: number;
  y: number;
  width: number;
  height: number;
  waiting: boolean;
}
interface BoosterOpeningOptions {
  interactive?: boolean;
  setCode?: string;
  set?: ScryfallSet;
  onChange?: (state: BoosterOpeningState | null) => void;
  onComplete?: () => void;
}
const LAND_DURATION = 0.22;
const TEAR_DURATION = 0.24;
const PEEL_DURATION = 0.3;
const EXTRACT_DURATION = 0.4;
const FAN_DURATION = 0.22;
const SETTLE_DURATION = 0.34;
const CARD_STAGGER = 0.018;
const STAGGER_LIMIT = 0.18;
const REST_TILT = -0.035;

export class LimitedBoosterReveal {
  private timeline: gsap.core.Timeline | null = null;
  private wrapper: Container | null = null;
  private cards: RevealCard[] = [];
  private waiting = false;
  private wrapperWidth = 0;
  private wrapperHeight = 0;
  private symbol: Sprite | null = null;
  private symbolCode: Text | null = null;
  private setName: Text | null = null;
  private iconUri: string | undefined;
  private tearStrip: Container | null = null;
  private tearGlint: Graphics | null = null;
  private tearDirection: BoosterTearDirection = "right";
  private onChange: BoosterOpeningOptions["onChange"];
  private onComplete: BoosterOpeningOptions["onComplete"];
  private readonly stage: Container;
  private readonly request: () => void;
  constructor(stage: Container, request: () => void) {
    this.stage = stage;
    this.request = request;
  }
  get active(): boolean {
    return this.wrapper !== null;
  }
  get animating(): boolean {
    return this.timeline !== null && !this.timeline.paused();
  }
  play(
    cards: RevealCard[],
    width: number,
    height: number,
    options: BoosterOpeningOptions = {},
  ): void {
    this.finish();
    this.cards = cards;
    this.onChange = options.onChange;
    this.onComplete = options.onComplete;
    if (!cards.length || !animationsEnabled()) {
      this.finish(true);
      return;
    }
    const theme = getTheme();
    const wrapperWidth = Math.min(cards[0].width + 20, width * 0.72);
    const wrapperHeight = Math.min(cards[0].height + 24, height * 0.8);
    this.wrapperWidth = wrapperWidth;
    this.wrapperHeight = wrapperHeight;
    const centerX = width / 2;
    const centerY = Math.min(height / 2, wrapperHeight / 2 + 24);
    const wrapper = new Container();
    wrapper.eventMode = "none";
    wrapper.position.set(centerX, centerY - 24);
    wrapper.rotation = -0.1;
    wrapper.scale.set(0.92);
    wrapper.alpha = 0;
    wrapper.zIndex = 4;
    const seamY = -wrapperHeight * 0.26;
    const left = -wrapperWidth / 2;
    const right = wrapperWidth / 2;
    const top = -wrapperHeight / 2;
    const bottom = wrapperHeight / 2;
    const upper = new Container();
    const lower = new Container();
    const foil = new FillGradient({
      end: { x: 1, y: 0 },
      colorStops: [
        { offset: 0, color: theme.appTheme.background },
        { offset: 0.035, color: theme.appTheme.foreground },
        { offset: 0.07, color: theme.appTheme.muted },
        { offset: 0.3, color: theme.appTheme.card },
        { offset: 0.52, color: theme.appTheme.muted },
        { offset: 0.57, color: theme.appTheme.card },
        { offset: 0.93, color: theme.appTheme.muted },
        { offset: 0.965, color: theme.appTheme.foreground },
        { offset: 1, color: theme.appTheme.background },
      ],
    });
    const highlight = hexToNum(theme.appTheme.foreground);
    const border = hexToNum(theme.appTheme.border);
    const accent = hexToNum(theme.gameTheme.cardRing);
    const topEdge: number[] = [left, seamY, left + 3, top + 4];
    const bottomEdge: number[] = [right, seamY, right - 3, bottom - 4];
    const edgeSteps = 24;
    for (let index = 0; index <= edgeSteps; index++) {
      topEdge.push(left + (wrapperWidth * index) / edgeSteps, top + (index % 2) * 3);
      bottomEdge.push(right - (wrapperWidth * index) / edgeSteps, bottom - (index % 2) * 3);
    }
    topEdge.push(right - 3, top + 4, right, seamY);
    bottomEdge.push(left + 3, bottom - 4, left, seamY);
    for (let index = edgeSteps; index >= 0; index--)
      topEdge.push(left + (wrapperWidth * index) / edgeSteps, seamY + (index % 2) * 2);
    for (let index = 0; index <= edgeSteps; index++)
      bottomEdge.push(left + (wrapperWidth * index) / edgeSteps, seamY + (index % 2) * 2);
    upper.addChild(new Graphics().poly(topEdge).fill(foil).stroke({ color: border, width: 1 }));
    lower.addChild(new Graphics().poly(bottomEdge).fill(foil).stroke({ color: border, width: 1 }));
    const folds = new Graphics();
    for (let index = 1; index < edgeSteps; index++) {
      const x = left + (wrapperWidth * index) / edgeSteps;
      folds.moveTo(x, top + 4).lineTo(x, top + 14);
    }
    folds.stroke({ color: highlight, alpha: 0.24, width: 1 });
    upper.addChild(folds);
    const brand = new Text({
      text: "MAGIC",
      style: {
        fontFamily: "Alegreya",
        fontSize: wrapperWidth * 0.2,
        fontWeight: "bold",
        letterSpacing: 1,
        fill: theme.appTheme.foreground,
      },
    });
    brand.anchor.set(0.5);
    brand.position.set(0, top + wrapperHeight * 0.16);
    upper.addChild(brand);
    const bodyDetail = new Graphics()
      .roundRect(left + 12, seamY + 12, wrapperWidth - 24, wrapperHeight * 0.4, 2)
      .fill({ color: accent, alpha: 0.1 })
      .stroke({ color: accent, alpha: 0.5, width: 1 })
      .poly([
        left + 8,
        seamY + 2,
        left + wrapperWidth * 0.5,
        seamY + 2,
        left + wrapperWidth * 0.8,
        bottom - 16,
        left + wrapperWidth * 0.6,
        bottom - 16,
      ])
      .fill({ color: highlight, alpha: 0.07 })
      .rect(left + 4, bottom - 15, wrapperWidth - 8, 11)
      .fill({ color: highlight, alpha: 0.1 });
    for (let index = 1; index < edgeSteps; index++) {
      const x = left + (wrapperWidth * index) / edgeSteps;
      bodyDetail.moveTo(x, bottom - 14).lineTo(x, bottom - 4);
    }
    bodyDetail.stroke({ color: highlight, alpha: 0.24, width: 1 });
    for (const x of [left + 6, right - 6]) bodyDetail.moveTo(x, seamY + 3).lineTo(x, bottom - 17);
    bodyDetail.stroke({ color: highlight, alpha: 0.2, width: 1 });
    const symbol = new Sprite();
    symbol.anchor.set(0.5);
    symbol.position.set(0, wrapperHeight * 0.025);
    symbol.width = symbol.height = wrapperWidth * 0.36;
    symbol.tint = highlight;
    symbol.visible = false;
    const symbolCode = new Text({
      style: {
        fontFamily: "Alegreya Sans",
        fontSize: wrapperWidth * 0.2,
        fontWeight: "bold",
        fill: theme.appTheme.foreground,
      },
    });
    symbolCode.anchor.set(0.5);
    symbolCode.position.copyFrom(symbol.position);
    const setName = new Text({
      style: {
        fontFamily: "Alegreya",
        fontSize: Math.min(14, wrapperWidth * 0.105),
        fontWeight: "bold",
        fill: theme.appTheme.foreground,
        align: "center",
        wordWrap: true,
        wordWrapWidth: wrapperWidth - 24,
        breakWords: true,
      },
    });
    setName.anchor.set(0.5);
    setName.position.set(0, bottom - wrapperHeight * 0.26);
    const packType = new Text({
      text: `${cards.length}-CARD BOOSTER`,
      style: {
        fontFamily: "Alegreya Sans",
        fontSize: Math.max(7, wrapperWidth * 0.055),
        fontWeight: "bold",
        letterSpacing: 0.6,
        fill: theme.appTheme.foreground,
      },
    });
    packType.anchor.set(0.5);
    packType.position.set(0, bottom - 23);
    lower.addChild(bodyDetail, symbol, symbolCode, setName, packType);
    this.symbol = symbol;
    this.symbolCode = symbolCode;
    this.setName = setName;
    const seam = new Graphics();
    for (let x = left + 5; x < right - 5; x += 9)
      seam.moveTo(x, seamY + 1).lineTo(Math.min(x + 5, right - 5), seamY + 1);
    seam.stroke({ color: accent, width: 2, alpha: 0.65 });
    const tear = new Container();
    const tearLine = new Graphics()
      .rect(0, -1.5, wrapperWidth, 3)
      .fill(accent)
      .stroke({ color: highlight, width: 1, alpha: 0.7 });
    tearLine.scale.x = 0;
    const glint = new Graphics()
      .star(0, 0, 4, wrapperWidth * 0.065, wrapperWidth * 0.012, Math.PI / 4)
      .fill(highlight);
    glint.visible = false;
    tear.addChild(tearLine, glint);
    tear.position.set(left, seamY + 1);
    this.tearStrip = tear;
    this.tearGlint = glint;
    wrapper.addChild(upper, lower, seam, tear);
    this.stage.addChild(wrapper);
    this.wrapper = wrapper;
    this.setIdentity(options.setCode, options.set);
    this.waiting = options.interactive !== false;
    cards.forEach(({ motion, x, y, width: cardWidth, height: cardHeight }, index) => {
      motion.position.set(
        centerX - x - cardWidth * 0.41,
        centerY - y - cardHeight * 0.41 + index * 1.5,
      );
      motion.scale.set(0.82);
      motion.rotation = REST_TILT;
      motion.alpha = 0;
    });
    const timeline = gsap.timeline({
      paused: true,
      onUpdate: this.changed,
      onComplete: () => this.finish(true),
    });
    this.timeline = timeline;
    timeline.to(
      wrapper,
      {
        y: centerY,
        rotation: REST_TILT,
        alpha: 1,
        duration: LAND_DURATION,
        ease: "power2.out",
      },
      0,
    );
    timeline.to(wrapper.scale, { x: 1, y: 1, duration: LAND_DURATION, ease: "power2.out" }, 0);
    if (this.waiting) timeline.addPause(LAND_DURATION, this.changed);
    timeline.to(tearLine.scale, { x: 1, duration: TEAR_DURATION, ease: "none" }, LAND_DURATION);
    const peelStart = LAND_DURATION + TEAR_DURATION;
    const extractStart = peelStart + 0.09;
    const extractEnd = extractStart + EXTRACT_DURATION;
    timeline.to(
      wrapper.scale,
      { x: 1.035, y: 0.98, duration: 0.065, ease: "power2.in" },
      peelStart,
    );
    timeline.to(
      wrapper.scale,
      { x: 1, y: 1, duration: 0.16, ease: "back.out(2)" },
      peelStart + 0.065,
    );
    timeline.to(
      upper,
      {
        x: -wrapperWidth * 0.35,
        y: -wrapperHeight * 0.3,
        rotation: -0.55,
        alpha: 0,
        duration: PEEL_DURATION,
        ease: "power2.in",
      },
      peelStart,
    );
    timeline.to(
      lower,
      {
        x: wrapperWidth * 0.08,
        y: wrapperHeight * 0.5,
        rotation: 0.12,
        alpha: 0,
        duration: PEEL_DURATION,
        ease: "power2.in",
      },
      extractEnd - 0.05,
    );
    timeline.to([seam, tear], { alpha: 0, duration: 0.12 }, peelStart);
    cards.forEach(({ motion, x, y, width: cardWidth, height: cardHeight }, index) => {
      const offset = index - (cards.length - 1) / 2;
      const liftStart = extractStart + Math.min(index * CARD_STAGGER * 0.5, STAGGER_LIMIT * 0.5);
      const fanStart = liftStart + EXTRACT_DURATION;
      timeline.to(
        motion,
        {
          x: centerX - x - cardWidth * 0.44 + offset * 0.7,
          y: Math.max(8, centerY + seamY - cardHeight * 0.8) - y + index * 0.45,
          rotation: REST_TILT * 0.3,
          duration: EXTRACT_DURATION,
          ease: "power3.out",
        },
        liftStart,
      );
      timeline.to(motion, { alpha: 1, duration: 0.12, ease: "power1.out" }, liftStart);
      timeline.to(
        motion.scale,
        { x: 0.88, y: 0.88, duration: EXTRACT_DURATION, ease: "power3.out" },
        liftStart,
      );
      timeline.to(
        motion,
        {
          x: centerX - x - cardWidth / 2 + offset * cardWidth * 0.09,
          y: centerY - y - cardHeight / 2 - 16 + Math.abs(offset) * 1.5,
          rotation: offset * 0.018,
          alpha: 1,
          duration: FAN_DURATION,
          ease: "power2.out",
        },
        fanStart,
      );
      timeline.to(
        motion,
        {
          x: 0,
          y: 0,
          rotation: 0,
          duration: SETTLE_DURATION,
          ease: "power3.out",
        },
        fanStart + FAN_DURATION,
      );
      timeline.to(
        motion.scale,
        {
          x: 1,
          y: 1,
          duration: SETTLE_DURATION,
          ease: "power3.out",
        },
        fanStart + FAN_DURATION,
      );
    });
    this.changed();
    timeline.play();
  }
  open(): void {
    if (!this.timeline || !this.waiting) return;
    if (!animationsEnabled()) {
      this.finish(true);
      return;
    }
    this.waiting = false;
    this.timeline.removePause(LAND_DURATION);
    this.timeline.play();
    this.changed();
  }
  tear(progress: number, direction: BoosterTearDirection = "right"): void {
    if (!this.timeline || !this.waiting) return;
    if (!animationsEnabled()) {
      this.finish(true);
      return;
    }
    const amount = Math.max(0, Math.min(1, progress));
    this.tearDirection = direction;
    if (this.tearStrip) {
      this.tearStrip.x = ((direction === "left" ? 1 : -1) * this.wrapperWidth) / 2;
      this.tearStrip.scale.x = direction === "left" ? -1 : 1;
    }
    this.timeline.pause().seek(LAND_DURATION + amount * TEAR_DURATION, true);
    this.changed();
    if (amount === 1) this.open();
  }
  setIdentity(setCode: string | undefined, set: ScryfallSet | undefined): void {
    const symbol = this.symbol;
    const symbolCode = this.symbolCode;
    const setName = this.setName;
    if (!symbol || !symbolCode || !setName) return;
    const name = set?.name ?? setCode?.toUpperCase() ?? "Booster";
    if (setName.text !== name) {
      setName.text = name;
      setName.scale.set(1);
      setName.scale.set(
        Math.min(
          1,
          (this.wrapperWidth - 24) / setName.width,
          (this.wrapperHeight * 0.17) / setName.height,
        ),
      );
      this.request();
    }
    symbolCode.text = setCode?.toUpperCase() ?? "";
    const iconUri = set?.icon_svg_uri;
    if (this.iconUri === iconUri) return;
    this.iconUri = iconUri;
    symbol.visible = false;
    symbolCode.visible = true;
    this.request();
    if (!iconUri) return;
    void setSymbolTexture(iconUri)
      .then((texture) => {
        if (this.symbol !== symbol || this.iconUri !== iconUri) return;
        symbol.texture = texture;
        symbol.width = symbol.height = this.wrapperWidth * 0.36;
        symbol.visible = true;
        symbolCode.visible = false;
        this.request();
      })
      .catch(() => undefined);
  }
  private readonly changed = (): void => {
    const wrapper = this.wrapper;
    if (!wrapper) return;
    const tearProgress = Math.max(
      0,
      Math.min(1, ((this.timeline?.time() ?? 0) - LAND_DURATION) / TEAR_DURATION),
    );
    if (this.tearGlint) {
      this.tearGlint.x = this.wrapperWidth * tearProgress;
      this.tearGlint.visible = tearProgress > 0 && tearProgress < 1;
    }
    if (this.waiting && (this.timeline?.time() ?? 0) >= LAND_DURATION) {
      const flex = Math.sin(tearProgress * Math.PI);
      const direction = this.tearDirection === "left" ? -1 : 1;
      wrapper.rotation = REST_TILT + direction * flex * 0.025;
      wrapper.skew.x = direction * flex * 0.018;
    } else wrapper.skew.x = 0;
    const cos = Math.abs(Math.cos(wrapper.rotation));
    const sin = Math.abs(Math.sin(wrapper.rotation));
    const width =
      cos * this.wrapperWidth * wrapper.scale.x + sin * this.wrapperHeight * wrapper.scale.y;
    const height =
      sin * this.wrapperWidth * wrapper.scale.x + cos * this.wrapperHeight * wrapper.scale.y;
    this.onChange?.({
      x: wrapper.x - width / 2,
      y: wrapper.y - height / 2,
      width,
      height,
      waiting: this.waiting,
    });
    this.request();
  };
  finish(complete = false): void {
    const onChange = this.onChange;
    const onComplete = complete ? this.onComplete : undefined;
    this.onChange = undefined;
    this.onComplete = undefined;
    this.waiting = false;
    this.timeline?.kill();
    this.timeline = null;
    for (const { motion } of this.cards) {
      if (motion.destroyed) continue;
      motion.position.set(0, 0);
      motion.scale.set(1);
      motion.rotation = 0;
      motion.alpha = 1;
    }
    this.cards = [];
    this.wrapper?.removeFromParent();
    this.wrapper?.destroy({ children: true });
    this.wrapper = null;
    this.symbol = null;
    this.symbolCode = null;
    this.setName = null;
    this.iconUri = undefined;
    this.tearStrip = null;
    this.tearGlint = null;
    this.tearDirection = "right";
    onChange?.(null);
    this.request();
    onComplete?.();
  }
}
