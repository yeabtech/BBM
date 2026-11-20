export function cameraScreenPosition(
  worldPosition: number,
  scroll: number,
  viewportSize: number,
  zoom: number,
): number {
  return (worldPosition - scroll) * zoom + (viewportSize * (1 - zoom)) / 2;
}

export function cameraScrollForScreenPosition(
  worldPosition: number,
  screenPosition: number,
  viewportSize: number,
  zoom: number,
): number {
  return (
    worldPosition - (screenPosition - (viewportSize * (1 - zoom)) / 2) / zoom
  );
}

export function cameraHudPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  zoom: number,
): { x: number; y: number } {
  return {
    x: width / 2 + (x - width / 2) / zoom,
    y: height / 2 + (y - height / 2) / zoom,
  };
}
