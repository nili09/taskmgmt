/**
 * Photos are shrunk on the device before they are sent, because the line may be a phone's and
 * the limit is 10 MB. Anything that is not an image is sent as it is.
 */
const LONG_EDGE = 2000;
const QUALITY = 0.82;

export async function prepare(file: File): Promise<{ blob: Blob; name: string; mime: string }> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") {
    return { blob: file, name: file.name, mime: file.type || "application/octet-stream" };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return { blob: file, name: file.name, mime: file.type };
    return { blob, name: file.name.replace(/\.[^.]+$/, "") + ".jpg", mime: "image/jpeg" };
  } catch {
    return { blob: file, name: file.name, mime: file.type || "application/octet-stream" };
  }
}
