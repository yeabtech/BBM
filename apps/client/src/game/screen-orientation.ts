interface LockableOrientation extends ScreenOrientation {
  lock?: (orientation: "landscape") => Promise<void>;
}

export function setupGameOrientation(gameRoot: HTMLElement): () => void {
  const prompt = gameRoot.querySelector<HTMLElement>("#orientation-prompt");
  const message = gameRoot.querySelector<HTMLElement>("#orientation-message");
  const action = gameRoot.querySelector<HTMLButtonElement>(
    "#orientation-action",
  );
  const back = gameRoot.querySelector<HTMLButtonElement>("#orientation-back");
  if (!prompt || !message || !action || !back)
    throw new Error("Missing game orientation controls");

  const orientation =
    "orientation" in screen
      ? (screen.orientation as LockableOrientation)
      : null;
  const lockLandscape = async (): Promise<boolean> => {
    if (!orientation || typeof orientation.lock !== "function") return false;
    try {
      await orientation.lock("landscape");
      return true;
    } catch {
      return false;
    }
  };

  void lockLandscape();

  const onAction = async () => {
    if (!document.fullscreenElement && gameRoot.requestFullscreen) {
      try {
        await gameRoot.requestFullscreen();
      } catch {
        // Fullscreen is an optional browser capability; manual rotation remains available.
      }
    }
    if (!(await lockLandscape()))
      message.textContent =
        "Your browser cannot rotate automatically. Turn your phone sideways to play.";
  };
  const onBack = () => {
    gameRoot.querySelector<HTMLAnchorElement>("#game-lobby-link")?.click();
  };
  action.addEventListener("click", onAction);
  back.addEventListener("click", onBack);

  return () => {
    action.removeEventListener("click", onAction);
    back.removeEventListener("click", onBack);
    if (orientation && typeof orientation.unlock === "function")
      orientation.unlock();
    if (document.fullscreenElement === gameRoot)
      void document.exitFullscreen().catch(() => undefined);
  };
}
