// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isAnimatedImage } from "./still-frame";

const text = (value: string) => [...value].map((c) => c.charCodeAt(0));
const bytes = (...parts: (string | number[])[]) => Uint8Array.from(parts.flatMap((part) => (typeof part === "string" ? text(part) : part)));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type: string, data: number[] = []) => [...be32(data.length), ...text(type), ...data, 0, 0, 0, 0];
const zeros = (length: number) => Array.from({ length }, () => 0);
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const webp = (chunkType: string, flags: number) => bytes("RIFF", [0, 0, 0, 0], "WEBP", chunkType, [10, 0, 0, 0, flags, 0, 0, 0, 0, 0]);

describe("isAnimatedImage", () => {
  it("sees every GIF as animated", () => {
    expect(isAnimatedImage(bytes("GIF89a", [1, 0, 1, 0, 0, 0]))).toBe(true);
    expect(isAnimatedImage(bytes("GIF87a", [1, 0, 1, 0, 0, 0]))).toBe(true);
  });

  it("reads a WebP's animation flag, not stray text", () => {
    expect(isAnimatedImage(webp("VP8X", 0x02))).toBe(true);
    expect(isAnimatedImage(webp("VP8X", 0x10))).toBe(false);
    expect(isAnimatedImage(webp("VP8 ", 0x02))).toBe(false);
    expect(isAnimatedImage(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ", [4, 0, 0, 0], "ANIM"))).toBe(false);
  });

  it("walks the PNG chunks for acTL before IDAT", () => {
    const apng = bytes(PNG, chunk("IHDR", zeros(13)), chunk("acTL", zeros(8)), chunk("IDAT", [1, 2]));
    const still = bytes(PNG, chunk("IHDR", zeros(13)), chunk("IDAT", [1, 2]), chunk("acTL", zeros(8)));
    const textual = bytes(PNG, chunk("IHDR", zeros(13)), chunk("tEXt", text("acTL")), chunk("IDAT", [1, 2]));
    expect(isAnimatedImage(apng)).toBe(true);
    expect(isAnimatedImage(still)).toBe(false);
    expect(isAnimatedImage(textual)).toBe(false);
  });

  it("finds acTL after a long ancillary chunk", () => {
    const profile = chunk("iCCP", Array.from({ length: 5000 }, () => 7));
    expect(isAnimatedImage(bytes(PNG, chunk("IHDR", zeros(13)), profile, chunk("acTL", zeros(8)), chunk("IDAT", [1])))).toBe(true);
  });

  it("leaves JPEG and short files alone", () => {
    expect(isAnimatedImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]))).toBe(false);
    expect(isAnimatedImage(new Uint8Array(3))).toBe(false);
  });
});

describe("stillFrameUrl", () => {
  const GIF_BYTES = bytes("GIF89a", [1, 0, 1, 0, 0, 0]);
  const PNG_BYTES = bytes(PNG, chunk("IHDR", zeros(13)), chunk("IDAT", [1]));
  const close = vi.fn();
  const fetchMock = vi.fn();
  const bitmapMock = vi.fn();

  // A fresh module per test, so no test inherits another's cache.
  const load = async () => import("./still-frame");
  const reply = (data: Uint8Array, ok = true) => ({ ok, status: ok ? 200 : 404, blob: async () => new Blob([data as BlobPart]) });

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    bitmapMock.mockReset().mockResolvedValue({ width: 8, height: 8, close });
    close.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("createImageBitmap", bitmapMock);
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (done: (blob: Blob | null) => void) => done(new Blob(["png"])) };
    const real = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => (tag === "canvas" ? canvas : real(tag))) as typeof document.createElement);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:made-still");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("makes the first frame of a GIF once, and knows it afterwards", async () => {
    fetchMock.mockResolvedValue(reply(GIF_BYTES));
    const { stillFrameUrl, peekStill } = await load();
    expect(peekStill("/a.gif")).toBeUndefined();
    expect(await stillFrameUrl("/a.gif")).toBe("blob:made-still");
    expect(await stillFrameUrl("/a.gif")).toBe("blob:made-still");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(peekStill("/a.gif")).toBe("blob:made-still");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("shares one request between callers that ask at the same time", async () => {
    fetchMock.mockResolvedValue(reply(GIF_BYTES));
    const { stillFrameUrl } = await load();
    await Promise.all([stillFrameUrl("/a.gif"), stillFrameUrl("/a.gif")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches null for a picture that does not move, and never decodes it", async () => {
    fetchMock.mockResolvedValue(reply(PNG_BYTES));
    const { stillFrameUrl, peekStill } = await load();
    expect(await stillFrameUrl("/a.png")).toBeNull();
    expect(await stillFrameUrl("/a.png")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(peekStill("/a.png")).toBeNull();
    expect(bitmapMock).not.toHaveBeenCalled();
  });

  it("does not cache a failed fetch, so the next ask tries again", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(reply(GIF_BYTES));
    const { stillFrameUrl, peekStill } = await load();
    expect(await stillFrameUrl("/a.gif")).toBeNull();
    expect(peekStill("/a.gif")).toBeUndefined();
    expect(await stillFrameUrl("/a.gif")).toBe("blob:made-still");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache an error response", async () => {
    fetchMock.mockResolvedValueOnce(reply(new Uint8Array(), false)).mockResolvedValueOnce(reply(GIF_BYTES));
    const { stillFrameUrl, peekStill } = await load();
    expect(await stillFrameUrl("/a.gif")).toBeNull();
    expect(peekStill("/a.gif")).toBeUndefined();
    expect(await stillFrameUrl("/a.gif")).toBe("blob:made-still");
  });

  it("does not cache a picture that fails to decode", async () => {
    fetchMock.mockResolvedValue(reply(GIF_BYTES));
    bitmapMock.mockRejectedValueOnce(new Error("bad gif"));
    const { stillFrameUrl, peekStill } = await load();
    expect(await stillFrameUrl("/a.gif")).toBeNull();
    expect(peekStill("/a.gif")).toBeUndefined();
    expect(await stillFrameUrl("/a.gif")).toBe("blob:made-still");
  });
});
