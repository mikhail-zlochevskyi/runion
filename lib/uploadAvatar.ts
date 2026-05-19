import type { createClient } from "@/lib/supabase/client";

type SB = NonNullable<ReturnType<typeof createClient>>;

const MAX_DIM = 512;
const JPEG_QUALITY = 0.82;

export async function compressAvatar(file: File): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode the image."));
    image.src = dataUrl;
  });

  const ratio = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const width = Math.round(img.width * ratio);
  const height = Math.round(img.height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported in this browser.");
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY)
  );
  if (!blob) throw new Error("Could not compress the image.");
  return blob;
}

export async function uploadAvatar(
  supabase: SB,
  userId: string,
  file: File
): Promise<{ url: string }> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Pick an image file (JPG, PNG, or HEIC).");
  }
  const blob = await compressAvatar(file);
  const path = `${userId}/avatar.jpg`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, blob, {
      contentType: "image/jpeg",
      upsert: true,
      cacheControl: "3600",
    });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  // Cache-bust so the new image shows immediately.
  const url = `${data.publicUrl}?v=${Date.now()}`;
  return { url };
}
