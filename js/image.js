// Shrink a visitor photo before it is saved in this browser.
import { MAX_ICON_URL } from './icons.js';

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that photo.'));
    };
    img.src = url;
  });
}

export async function resizeImageFile(file, { max = 96 } = {}) {
  if (!file || !/^image\/(png|jpeg|webp|gif)$/i.test(file.type || '')) {
    throw new Error('Choose a PNG, JPEG, or WebP photo.');
  }
  const img = await loadImage(file);
  const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
  const width = Math.max(1, Math.round((img.width || max) * scale));
  const height = Math.max(1, Math.round((img.height || max) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  let url = canvas.toDataURL('image/jpeg', 0.72);
  if (url.length > MAX_ICON_URL) url = canvas.toDataURL('image/jpeg', 0.45);
  if (url.length > MAX_ICON_URL) throw new Error('That photo is still too big. Try a smaller one.');
  return url;
}
