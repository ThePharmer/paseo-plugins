export interface Size {
  width: number;
  height: number;
}

/**
 * The displayed size of an image inside `bounds`: scaled down to fit, never scaled up, so small
 * images and icons keep their pixels sharp.
 */
export function fitImageSize(natural: Size, bounds: Size): Size {
  if (natural.width <= 0 || natural.height <= 0) return bounds;
  const scale = Math.min(1, bounds.width / natural.width, bounds.height / natural.height);
  return {
    width: Math.max(1, Math.floor(natural.width * scale)),
    height: Math.max(1, Math.floor(natural.height * scale)),
  };
}
