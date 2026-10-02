import { Application, Container, Graphics, Sprite } from "pixi.js";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";
import { OverlayRenderScheduler, overlayResolution } from "@/pixi/overlay/overlayRuntime";
import { destroyPixiApp, installPixiPatches } from "@/pixi/pixiPatches";

export interface LimitedPane {
  host: HTMLElement;
  root: Container;
  frame: () => boolean;
}
interface RegisteredPane {
  pane: LimitedPane;
  mask: Graphics;
  bounds: string;
}
interface CardFlight {
  pane: LimitedPane;
  sprite: Sprite;
  timeline: gsap.core.Timeline;
}
const PICK_FLIGHT_DURATION = 0.42;
let sharedRenderer: LimitedRenderer | null = null;
export function acquireLimitedRenderer(pane: LimitedPane): LimitedRenderer {
  if (!sharedRenderer) sharedRenderer = new LimitedRenderer();
  sharedRenderer.register(pane);
  return sharedRenderer;
}

export class LimitedRenderer {
  readonly ready: Promise<void>;
  private readonly app = new Application();
  private readonly canvas = document.createElement("canvas");
  private readonly panes = new Map<LimitedPane, RegisteredPane>();
  private readonly flightsLayer = new Container();
  private readonly flights = new Set<CardFlight>();
  private scheduler: OverlayRenderScheduler | null = null;
  private initialized = false;
  private disposed = false;
  constructor() {
    installPixiPatches();
    this.canvas.dataset.limitedWorkspace = "true";
    this.canvas.setAttribute("aria-hidden", "true");
    Object.assign(this.canvas.style, {
      position: "fixed",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "1",
    });
    document.body.appendChild(this.canvas);
    this.ready = this.initialize();
  }
  private async initialize(): Promise<void> {
    await this.app.init({
      canvas: this.canvas,
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundAlpha: 0,
      autoDensity: true,
      autoStart: false,
      antialias: true,
      resolution: overlayResolution(window.innerWidth, window.innerHeight),
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
    });
    this.initialized = true;
    if (this.disposed) {
      destroyPixiApp(this.app);
      return;
    }
    this.app.stage.eventMode = "none";
    for (const { pane, mask } of this.panes.values()) this.app.stage.addChild(pane.root, mask);
    this.flightsLayer.eventMode = "none";
    this.app.stage.addChild(this.flightsLayer);
    this.scheduler = new OverlayRenderScheduler(this.app, () => {
      let active = false;
      if (!animationsEnabled()) this.cancelFlights();
      for (const entry of this.panes.values()) {
        this.place(entry);
        active = entry.pane.frame() || active;
      }
      return active || this.flights.size > 0;
    });
    window.addEventListener("scroll", this.request, true);
    window.addEventListener("resize", this.resize);
    window.visualViewport?.addEventListener("resize", this.resize);
    window.visualViewport?.addEventListener("scroll", this.request);
    this.resize();
  }
  register(pane: LimitedPane): void {
    const mask = new Graphics();
    mask.eventMode = "none";
    pane.root.mask = mask;
    this.panes.set(pane, { pane, mask, bounds: "" });
    if (this.initialized) {
      this.app.stage.addChild(pane.root, mask);
      this.app.stage.setChildIndex(this.flightsLayer, this.app.stage.children.length - 1);
    }
    this.request();
  }
  release(pane: LimitedPane): void {
    const entry = this.panes.get(pane);
    if (!entry) return;
    this.cancelFlights(pane);
    pane.root.mask = null;
    pane.root.removeFromParent();
    entry.mask.removeFromParent();
    entry.mask.destroy();
    this.panes.delete(pane);
    this.request();
    if (this.panes.size) return;
    queueMicrotask(this.disposeWhenUnused);
  }
  private readonly disposeWhenUnused = (): void => {
    if (this.disposed || this.panes.size) return;
    this.disposed = true;
    if (sharedRenderer === this) sharedRenderer = null;
    this.cancelFlights();
    this.scheduler?.dispose();
    window.removeEventListener("scroll", this.request, true);
    window.removeEventListener("resize", this.resize);
    window.visualViewport?.removeEventListener("resize", this.resize);
    window.visualViewport?.removeEventListener("scroll", this.request);
    this.canvas.remove();
    if (this.initialized) destroyPixiApp(this.app);
  };
  readonly request = (): void => {
    this.scheduler?.request();
  };
  flyCard(pane: LimitedPane, source: Sprite, departureTarget: () => HTMLElement | null): void {
    const entry = this.panes.get(pane);
    if (!entry || !animationsEnabled() || this.disposed || source.texture.width <= 1) return;
    this.place(entry);
    const target = departureTarget();
    if (!pane.root.visible || !target?.isConnected || !target.getClientRects().length) return;
    const destination = target.getBoundingClientRect();
    const bounds = source.getBounds();
    const paneBounds = entry.mask.getLocalBounds();
    if (
      destination.width <= 0 ||
      destination.height <= 0 ||
      destination.bottom <= 0 ||
      destination.top >= window.innerHeight ||
      destination.right <= 0 ||
      destination.left >= window.innerWidth ||
      bounds.width <= 0 ||
      bounds.height <= 0 ||
      bounds.x + bounds.width <= paneBounds.x ||
      bounds.y + bounds.height <= paneBounds.y ||
      bounds.x >= paneBounds.x + paneBounds.width ||
      bounds.y >= paneBounds.y + paneBounds.height
    )
      return;
    const center = source.toGlobal({ x: source.texture.width / 2, y: source.texture.height / 2 });
    const transform = source.worldTransform;
    const sprite = new Sprite(source.texture);
    sprite.eventMode = "none";
    sprite.anchor.set(0.5);
    sprite.position.copyFrom(center);
    sprite.width = source.texture.width * Math.hypot(transform.a, transform.b);
    sprite.height = source.texture.height * Math.hypot(transform.c, transform.d);
    sprite.rotation = Math.atan2(transform.b, transform.a);
    sprite.alpha = pane.root.alpha;
    this.flightsLayer.addChild(sprite);
    const left = Math.max(0, destination.left);
    const top = Math.max(0, destination.top);
    const right = Math.min(window.innerWidth, destination.right);
    const bottom = Math.min(window.innerHeight, destination.bottom);
    const destinationWidth = Math.min(sprite.width * 0.68, (right - left) * 0.18);
    const destinationHeight = (destinationWidth * sprite.height) / sprite.width;
    const x = (left + right) / 2;
    const y = top + Math.min((bottom - top) / 2, destinationHeight);
    const timeline = gsap.timeline({
      onUpdate: this.request,
      onComplete: () => this.removeFlight(flight),
    });
    const flight: CardFlight = { pane, sprite, timeline };
    this.flights.add(flight);
    timeline.to(sprite, {
      x,
      y,
      rotation: 0,
      duration: PICK_FLIGHT_DURATION,
      ease: "power2.inOut",
    });
    timeline.to(
      sprite.scale,
      {
        x: destinationWidth / source.texture.width,
        y: destinationHeight / source.texture.height,
        duration: PICK_FLIGHT_DURATION,
        ease: "power2.inOut",
      },
      0,
    );
    timeline.to(sprite, { alpha: 0, duration: 0.1 }, PICK_FLIGHT_DURATION - 0.1);
    this.request();
  }
  cancelFlights(pane?: LimitedPane): void {
    for (const flight of this.flights) {
      if (!pane || flight.pane === pane) this.removeFlight(flight);
    }
  }
  private removeFlight(flight: CardFlight): void {
    flight.timeline.kill();
    flight.sprite.removeFromParent();
    flight.sprite.destroy({ texture: false, textureSource: false });
    this.flights.delete(flight);
    this.request();
  }
  private readonly resize = (): void => {
    if (!this.initialized || this.disposed) return;
    this.app.renderer.resolution = overlayResolution(window.innerWidth, window.innerHeight);
    this.app.renderer.resize(window.innerWidth, window.innerHeight);
    this.request();
  };
  private place(entry: RegisteredPane): void {
    const { host, root } = entry.pane;
    const bounds = host.getBoundingClientRect();
    root.position.set(bounds.left, bounds.top);
    root.scale.set(
      host.clientWidth ? bounds.width / host.clientWidth : 1,
      host.clientHeight ? bounds.height / host.clientHeight : 1,
    );
    let opacity = 1;
    let visible = true;
    let left = Math.max(0, bounds.left);
    let top = Math.max(0, bounds.top);
    let right = Math.min(window.innerWidth, bounds.right);
    let bottom = Math.min(window.innerHeight, bounds.bottom);
    let ancestor: HTMLElement | null = host;
    while (ancestor && ancestor !== document.body) {
      const style = getComputedStyle(ancestor);
      opacity *= Number(style.opacity);
      if (style.visibility === "hidden" || style.visibility === "collapse") visible = false;
      const clipX = style.overflowX !== "visible";
      const clipY = style.overflowY !== "visible";
      if (clipX || clipY) {
        const rect = ancestor.getBoundingClientRect();
        const scaleX = ancestor.offsetWidth ? rect.width / ancestor.offsetWidth : 1;
        const scaleY = ancestor.offsetHeight ? rect.height / ancestor.offsetHeight : 1;
        if (clipX) {
          left = Math.max(left, rect.left + ancestor.clientLeft * scaleX);
          right = Math.min(
            right,
            rect.left + (ancestor.clientLeft + ancestor.clientWidth) * scaleX,
          );
        }
        if (clipY) {
          top = Math.max(top, rect.top + ancestor.clientTop * scaleY);
          bottom = Math.min(
            bottom,
            rect.top + (ancestor.clientTop + ancestor.clientHeight) * scaleY,
          );
        }
      }
      ancestor = ancestor.parentElement;
    }
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    root.visible = visible && width > 0 && height > 0 && host.getClientRects().length > 0;
    root.alpha = opacity;
    const key = `${left}:${top}:${width}:${height}`;
    if (entry.bounds !== key) {
      entry.bounds = key;
      entry.mask.clear().rect(left, top, width, height).fill();
    }
  }
}
