/** The first frame of an animated picture (GIF, animated WebP or APNG), so a bot that is not working can hold still. */

const cache = new Map<string, Promise<string | null>>();

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

/** Whether the file's own header says it has more than one frame. A still PNG, JPEG or WebP is not touched. */
export function isAnimatedImage(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const head = ascii(bytes, 0, 6);
  if (head === "GIF87a" || head === "GIF89a") return true;
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return ascii(bytes, 12, Math.min(bytes.length, 4096)).includes("ANIM");
  // APNG: an acTL chunk comes before the first IDAT.
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG") {
    const text = ascii(bytes, 0, Math.min(bytes.length, 4096));
    const actl = text.indexOf("acTL");
    return actl !== -1 && (text.indexOf("IDAT") === -1 || actl < text.indexOf("IDAT"));
  }
  return false;
}

async function makeStill(url: string): Promise<string | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  const blob = await response.blob();
  if (!isAnimatedImage(new Uint8Array(await blob.slice(0, 4096).arrayBuffer()))) return null;
  // A bitmap of an animated picture is its first frame.
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    const still = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return still ? URL.createObjectURL(still) : null;
  } finally {
    bitmap.close();
  }
}

/** An object URL for the picture's first frame, or null when the picture does not move or cannot be read (show the original). Made once per URL. */
export function stillFrameUrl(url: string): Promise<string | null> {
  let still = cache.get(url);
  if (!still) {
    still = makeStill(url).catch(() => null);
    cache.set(url, still);
  }
  return still;
}
