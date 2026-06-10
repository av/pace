import type { FlexContainerConfig } from "./types";

export function flexStyle(f?: number): string {
  return `flex:${f ?? 1};`;
}

export function flexContainerStyle(container: FlexContainerConfig): string {
  return `display:flex; flex-direction:${container.direction}; gap:${container.gap ?? "1rem"}; ${flexStyle(container.flex)}`;
}