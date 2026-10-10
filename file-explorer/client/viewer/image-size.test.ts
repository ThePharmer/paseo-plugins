import { describe, expect, it } from "vitest";
import { fitImageSize } from "./image-size";

describe("fitImageSize", () => {
  const bounds = { width: 400, height: 300 };

  it("never scales small images up", () => {
    expect(fitImageSize({ width: 32, height: 32 }, bounds)).toEqual({ width: 32, height: 32 });
  });

  it("scales large images down, keeping the aspect ratio", () => {
    expect(fitImageSize({ width: 1600, height: 900 }, bounds)).toEqual({ width: 400, height: 225 });
    expect(fitImageSize({ width: 600, height: 1200 }, bounds)).toEqual({ width: 150, height: 300 });
  });

  it("fills the bounds when the natural size is unknown", () => {
    expect(fitImageSize({ width: 0, height: 0 }, bounds)).toEqual(bounds);
  });
});
