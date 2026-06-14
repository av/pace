import type { FlexContainerConfig } from "./types";

export function flexStyle(f?: number): string {
  // flex:0 shorthand means "flex: 0 1 0px" (grow=0, shrink=1, basis=0), which
  // collapses the element to zero size. The user intent for flex:0 is "don't
  // grow, use natural/intrinsic size." flex:none (= 0 0 auto) achieves that.
  if (f === 0) return "flex:none;";
  return `flex:${f ?? 1};`;
}

export function flexContainerStyle(container: FlexContainerConfig): string {
  return `display:flex; flex-direction:${container.direction}; gap:${container.gap ?? "1rem"}; ${flexStyle(container.flex)}`;
}