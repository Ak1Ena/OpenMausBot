/** The first frame of an animated picture (GIF, animated WebP or APNG), so a bot that is not working can hold still. */

const SNIFF_BYTES = 64 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP_ANIMATION_FLAG = 0x02;

/** Pictures that settled: a still's object URL, or null when the picture does not move. Read during render, so a remount starts still. */
const resolved = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

function isAnimatedPng(bytes: Uint8Array): boolean {
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Chunks run length, type, data, CRC; an acTL chunk before the first IDAT marks an APNG.
  for (let at = 8; at + 8 <= bytes.length; ) {
    const type = ascii(bytes, at + 4, at + 8);
    if (type === "acTL") return true;
    if (type === "IDAT") return false;
    at += 12 + view.getUint32(at);
  }
  return false;
}

/** Whether the file's own header says it has more than one frame. A still PNG, JPEG or WebP is not touched. */
export function isAnimatedImage(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const head = ascii(bytes, 0, 6);
  if (head === "GIF87a" || head === "GIF89a") return true;
  // WebP: an extended file (VP8X) says in its flags whether it animates.
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return bytes.length > 20 && ascii(bytes, 12, 16) === "VP8X" && (bytes[20] & WEBP_ANIMATION_FLAG) !== 0;
  return isAnimatedPng(bytes);
}

/** The still's object URL, or null for a picture that does not move. Throws when the picture cannot be read. */
async function makeStill(url: string): Promise<string | null> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`avatar ${response.status}`);
  const blob = await response.blob();
  if (!isAnimatedImage(new Uint8Array(await blob.slice(0, SNIFF_BYTES).arrayBuffer()))) return null;
  // A bitmap of an animated picture is its first frame.
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    const still = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!still) throw new Error("avatar still");
    return URL.createObjectURL(still);
  } finally {
    bitmap.close();
  }
}

/** The still already made for this picture: its URL, null for a picture that does not move, undefined when not known yet. */
export function peekStill(url: string): string | null | undefined {
  return resolved.get(url);
}

/** Makes the still once per URL. A picture that does not move settles as null; one that cannot be read is tried again next time. */
export function stillFrameUrl(url: string): Promise<string | null> {
  const known = resolved.get(url);
  if (known !== undefined) return Promise.resolve(known);
  let request = pending.get(url);
  if (!request) {
    request = makeStill(url).then(
      (src) => { resolved.set(url, src); pending.delete(url); return src; },
      () => { pending.delete(url); return null; },
    );
    pending.set(url, request);
  }
  return request;
}
