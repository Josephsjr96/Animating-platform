/* Conservative detector for straight, dark, bordered storyboard frames. */
(() => {
  'use strict';
  function detectPixels(width, height, data) {
    const dark = (x, y) => {
      const i = (y * width + x) * 4;
      return data[i + 3] > 128 && (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) < 65000;
    };
    const minWidth = Math.max(24, Math.floor(width * .18));
    const lines = [];
    let previous = [];
    for (let y = 0; y < height; y++) {
      const current = [];
      for (let x = 0; x < width;) {
        if (!dark(x, y)) { x++; continue; }
        const start = x;
        while (x < width && dark(x, y)) x++;
        if (x - start < minWidth || x - start > width * .92) continue;
        const line = previous.find(l => Math.abs(l.x - start) <= 2 && Math.abs(l.right - x) <= 2);
        if (line) { line.bottom = y + 1; current.push(line); }
        else { const next = {x:start, right:x, y, bottom:y + 1}; lines.push(next); current.push(next); }
      }
      previous = current;
    }
    const frames = [];
    for (const top of lines) {
      const bottom = lines.find(l => l.y >= top.bottom &&
        Math.abs(l.x - top.x) < width * .03 && Math.abs(l.right - top.right) < width * .03);
      if (!bottom) continue;
      const start = top.bottom, end = bottom.y;
      if (end - start < 16) continue;
      if ((end - start) > (top.right - top.x) * 2.5) continue;
      const border = (edge, side) => {
        const columns = [];
        const margin = Math.max(3, Math.ceil(width * .025));
        for (let x = Math.max(0, edge - margin); x < Math.min(width, edge + margin); x++) {
          let count = 0;
          for (let y = start; y < end; y++) if (dark(x, y)) count++;
          if (count / (end - start) >= .85) columns.push(x);
        }
        return columns.length ? (side === 'left' ? Math.max(...columns) + 1 : Math.min(...columns)) : null;
      };
      const left = border(Math.max(top.x, bottom.x), 'left');
      const right = border(Math.min(top.right, bottom.right) - 1, 'right');
      if (left == null || right == null || right - left < minWidth) continue;
      const box = {x:left, y:start, w:right - left, h:end - start};
      if (!frames.some(b => Math.abs(b.y - box.y) < 4 && Math.abs(b.x - box.x) < 4)) frames.push(box);
    }
    return frames.sort((a, b) => a.y - b.y || a.x - b.x);
  }
  function detect(image) {
    if (image.width * image.height > 24000000) return [];
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d', {willReadFrequently:true}); ctx.drawImage(image, 0, 0);
    return detectPixels(image.width, image.height, ctx.getImageData(0, 0, image.width, image.height).data);
  }
  function crop(image, box, edits = {}) {
    const scale = Math.min(1, 320 / Math.max(box.w, box.h));
    const canvas = document.createElement('canvas');
    const rotation = [0,90,180,270].includes(edits.rotation) ? edits.rotation : 0;
    const turned = rotation === 90 || rotation === 270;
    const width = Math.max(1,Math.round(box.w*scale)), height = Math.max(1,Math.round(box.h*scale));
    canvas.width = turned ? height : width; canvas.height = turned ? width : height;
    const ctx = canvas.getContext('2d');
    const amount = (key, fallback, min, max) => Number.isFinite(edits[key]) ? Math.max(min,Math.min(max,edits[key])) : fallback;
    ctx.filter = `brightness(${amount('brightness',100,50,150)}%) contrast(${amount('contrast',100,50,150)}%) saturate(${amount('saturation',100,0,200)}%)`;
    ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(rotation*Math.PI/180);ctx.scale(edits.flipX?-1:1,edits.flipY?-1:1);
    ctx.drawImage(image,box.x,box.y,box.w,box.h,-width/2,-height/2,width,height);
    return canvas.toDataURL('image/png').split(',')[1];
  }
  globalThis.StoryboardGeometry = {detectPixels, detect, crop};
})();
