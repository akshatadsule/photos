// Decoding, drawing and encoding happen outside the UI thread.
self.onmessage = async (event: MessageEvent<{ id: number; file: File }>) => {
  const { id, file } = event.data;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
      self.postMessage({ id, blob, width: bitmap.width, height: bitmap.height });
    } finally { bitmap.close(); }
  } catch { self.postMessage({ id, error: `Cannot read ${file.name}. Use a valid JPEG, PNG, or WebP image.` }); }
};
