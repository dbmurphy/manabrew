import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { getPlatformType } from "@/platform";

export function useFullscreen() {
  const native = getPlatformType() === "tauri";
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!native) {
      const sync = () => setIsFullscreen(document.fullscreenElement !== null);
      sync();
      document.addEventListener("fullscreenchange", sync);
      return () => document.removeEventListener("fullscreenchange", sync);
    }
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const sync = () => {
      void appWindow
        .isFullscreen()
        .then((value) => {
          if (!disposed) setIsFullscreen(value);
        })
        .catch(() => {});
    };
    sync();
    void appWindow
      .onResized(sync)
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [native]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (native) {
        const appWindow = getCurrentWindow();
        const next = !(await appWindow.isFullscreen());
        await appWindow.setFullscreen(next);
        setIsFullscreen(await appWindow.isFullscreen());
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      toast.error("Could not change fullscreen mode");
    }
  }, [native]);
  return { isFullscreen, toggleFullscreen };
}
