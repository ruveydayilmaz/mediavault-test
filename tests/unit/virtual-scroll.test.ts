import { describe, it, expect } from "vitest";
import { computeVisibleRange } from "../../src/ui/components/virtual-scroll";

describe("virtual-scroll: computeVisibleRange", () => {
  it("starts at index 0 when scrolled to the top, clamping overscan", () => {
    const range = computeVisibleRange(0, 400, 40, 10000, 5);
    expect(range.startIndex).toBe(0);
    expect(range.topSpacerHeight).toBe(0);
    expect(range.endIndex).toBe(15);
    expect(range.bottomSpacerHeight).toBe((10000 - 15) * 40);
  });

  it("computes the correct window when scrolled to the middle", () => {
    const range = computeVisibleRange(4000, 400, 40, 10000, 5);
    expect(range.startIndex).toBe(95);
    expect(range.endIndex).toBe(115);
    expect(range.topSpacerHeight).toBe(95 * 40);
  });

  it("clamps endIndex to totalItems near the end of the list", () => {
    const range = computeVisibleRange(399600, 400, 40, 10000, 5);
    expect(range.endIndex).toBeLessThanOrEqual(10000);
    expect(range.bottomSpacerHeight).toBeGreaterThanOrEqual(0);
  });

  it("handles an empty list without producing a negative or NaN range", () => {
    const range = computeVisibleRange(0, 400, 40, 0, 5);
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(0);
  });

  it("handles a zero row height without dividing by zero", () => {
    const range = computeVisibleRange(100, 400, 0, 500, 5);
    expect(Number.isNaN(range.startIndex)).toBe(false);
    expect(Number.isNaN(range.endIndex)).toBe(false);
  });
});
