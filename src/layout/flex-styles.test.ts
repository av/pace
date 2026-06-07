import { describe, it, expect } from "bun:test";
import { flexStyle, flexContainerStyle } from "./flex-styles";

describe("flexStyle", () => {
  it("defaults flex to 1 when omitted", () => {
    expect(flexStyle()).toBe("flex:1;");
  });

  it("uses explicit flex value", () => {
    expect(flexStyle(3)).toBe("flex:3;");
  });
});

describe("flexContainerStyle", () => {
  it("builds row container with default gap and flex", () => {
    expect(flexContainerStyle({ direction: "row", children: [] })).toBe(
      "display:flex; flex-direction:row; gap:1rem; flex:1;",
    );
  });

  it("respects explicit gap and flex", () => {
    expect(flexContainerStyle({ direction: "column", gap: "2rem", flex: 3, children: [] })).toBe(
      "display:flex; flex-direction:column; gap:2rem; flex:3;",
    );
  });
});