import { describe, expect, it } from "vitest";

import { isAnimatedImage } from "./still-frame";

const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part)));

describe("isAnimatedImage", () => {
  it("sees every GIF as animated", () => {
    expect(isAnimatedImage(bytes("GIF89a", [1, 0, 1, 0, 0, 0]))).toBe(true);
    expect(isAnimatedImage(bytes("GIF87a", [1, 0, 1, 0, 0, 0]))).toBe(true);
  });

  it("tells an animated WebP from a still one", () => {
    expect(isAnimatedImage(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8X", [10, 0, 0, 0, 2, 0, 0, 0], "ANIM"))).toBe(true);
    expect(isAnimatedImage(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ", [10, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });

  it("tells an APNG from a still PNG", () => {
    const png = [0x89, ...bytes("PNG"), 13, 10, 26, 10];
    expect(isAnimatedImage(bytes(png, "IHDR", [0, 0, 0, 0], "acTL", [0, 0, 0, 0], "IDAT"))).toBe(true);
    expect(isAnimatedImage(bytes(png, "IHDR", [0, 0, 0, 0], "IDAT"))).toBe(false);
  });

  it("leaves JPEG and short files alone", () => {
    expect(isAnimatedImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]))).toBe(false);
    expect(isAnimatedImage(new Uint8Array(3))).toBe(false);
  });
});
