import { Application, Container, Graphics } from "pixi.js";
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
    this.scheduler = new OverlayRenderScheduler(this.app, () => {
      let active = false;
      for (const entry of this.panes.values()) {
        this.place(entry);
        active = entry.pane.frame() || active;
      }
      return active;
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
    if (this.initialized) this.app.stage.addChild(pane.root, mask);
    this.request();
  }
  release(pane: LimitedPane): void {
    const entry = this.panes.get(pane);
    if (!entry) return;
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
