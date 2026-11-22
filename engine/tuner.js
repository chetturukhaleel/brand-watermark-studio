import { removeWatermark } from './blendModes.js';

// Shared "tune-it-yourself" helpers used by both the image and video tools.
// A removal is described by a base watermark box plus user tweaks:
//   { gain, offsetX, offsetY, sizeScale }
// Removal is always confined to the Gemini sparkle template shape, so only the
// logo pixels are ever altered — never the surrounding content.

export function getRoi(width, height, wm) {
    const pad = Math.round(wm.size * 0.6);
    const rx = Math.max(0, wm.x - pad);
    const ry = Math.max(0, wm.y - pad);
    const rw = Math.min(width - rx, wm.width + pad * 2);
    const rh = Math.min(height - ry, wm.height + pad * 2);
    return { x: rx, y: ry, width: rw, height: rh };
}

export function resolveBox(base, width, height, opts = {}) {
    const sizeScale = opts.sizeScale || 1;
    const size = Math.max(8, Math.min(Math.round(base.size * sizeScale), Math.min(width, height)));
    const x = Math.max(0, Math.min(base.x + Math.round(opts.offsetX || 0), width - size));
    const y = Math.max(0, Math.min(base.y + Math.round(opts.offsetY || 0), height - size));
    return { size, x, y, width: size, height: size };
}

/** Scaled Gemini sparkle alpha (template shape) placed inside the ROI, scaled by gain. */
export function buildAlpha(bgImg, roi, wm, gain) {
    const count = roi.width * roi.height;
    const alphaMap = new Float32Array(count);
    const offX = wm.x - roi.x;
    const offY = wm.y - roi.y;

    const c = document.createElement('canvas');
    c.width = wm.size; c.height = wm.size;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(bgImg, 0, 0, wm.size, wm.size);
    const data = cx.getImageData(0, 0, wm.size, wm.size).data;

    for (let row = 0; row < wm.size; row++) {
        for (let col = 0; col < wm.size; col++) {
            const ri = (offY + row) * roi.width + (offX + col);
            if (ri < 0 || ri >= count) continue;
            const o = (row * wm.size + col) * 4;
            const a = (Math.max(data[o], data[o + 1], data[o + 2]) / 255) * gain;
            alphaMap[ri] = a > 0 ? Math.min(a, 0.99) : 0;
        }
    }
    return alphaMap;
}

/** Clean a full-frame ImageData in place. Returns the resolved box + ROI for UI guides. */
export function cleanFrame(bgImg, imageData, width, height, base, opts = {}) {
    const wm = resolveBox(base, width, height, opts);
    const roi = getRoi(width, height, wm);
    const alpha = buildAlpha(bgImg, roi, wm, opts.gain ?? 1);
    removeWatermark(imageData, alpha, {
        x: roi.x, y: roi.y, width: roi.width, height: roi.height,
    });
    return { wm, roi };
}


/**
 * Search a decoded frame for the Gemini sparkle template.
 * Returns null when the best normalized template match is not convincing.
 * This scans the whole frame and estimates both location and scale.
 */
export function detectGeminiSparkle(imageData, width, height, templateImage) {
    const sampleSize = 16;
    const templateCanvas = document.createElement('canvas');
    templateCanvas.width = templateCanvas.height = sampleSize;
    const templateCtx = templateCanvas.getContext('2d', { willReadFrequently: true });
    templateCtx.drawImage(templateImage, 0, 0, sampleSize, sampleSize);
    const td = templateCtx.getImageData(0, 0, sampleSize, sampleSize).data;
    const pattern = new Float32Array(sampleSize * sampleSize);
    let tm = 0;
    for (let i = 0; i < pattern.length; i++) {
        pattern[i] = Math.max(td[i * 4], td[i * 4 + 1], td[i * 4 + 2]) / 255;
        tm += pattern[i];
    }
    tm /= pattern.length;
    let tv = 0;
    let patternSum = 0;
    for (let i = 0; i < pattern.length; i++) {
        pattern[i] -= tm;
        tv += pattern[i] * pattern[i];
        patternSum += pattern[i];
    }
    if (tv < 0.001) return null;

    const pixels = imageData.data;
    const minSide = Math.min(width, height);
    const candidates = [0.018, 0.022, 0.027, 0.032, 0.04, 0.05, 0.065, 0.08, 0.10];
    const scoreAt = (x, y, size) => {
        if (x < 0 || y < 0 || x + size > width || y + size > height) return -1;
        let mean = 0, sumSq = 0, dot = 0;
        for (let sy = 0; sy < sampleSize; sy++) {
            const py = y + Math.min(size - 1, Math.floor((sy + 0.5) * size / sampleSize));
            for (let sx = 0; sx < sampleSize; sx++) {
                const px = x + Math.min(size - 1, Math.floor((sx + 0.5) * size / sampleSize));
                const idx = (py * width + px) * 4;
                const lum = (pixels[idx] * 0.2126 + pixels[idx + 1] * 0.7152 + pixels[idx + 2] * 0.0722) / 255;
                const k = sy * sampleSize + sx;
                mean += lum;
                sumSq += lum * lum;
                dot += pattern[k] * lum;
            }
        }
        mean /= pattern.length;
        const variance = Math.max(0.00001, sumSq - pattern.length * mean * mean);
        return (dot - mean * patternSum) / Math.sqrt(tv * variance);
    };

    let best = null;
    for (const ratio of candidates) {
        const size = Math.round(minSide * ratio);
        if (size < 16 || size > minSide * 0.18) continue;
        const step = Math.max(4, Math.floor(size / 3));
        for (let y = 0; y <= height - size; y += step) {
            for (let x = 0; x <= width - size; x += step) {
                const score = scoreAt(x, y, size);
                if (!best || score > best.score) best = { x, y, size, score, coarseStep: step };
            }
        }
    }
    if (!best) return null;

    // The coarse pass finds the region. Refine position and scale at single-pixel
    // precision so the reverse-alpha mask aligns with the actual sparkle edges.
    const coarse = best;
    const minSize = Math.max(16, coarse.size - Math.max(3, Math.round(coarse.size * 0.12)));
    const maxSize = Math.min(Math.floor(minSide * 0.18), coarse.size + Math.max(3, Math.round(coarse.size * 0.12)));
    let refined = null;
    for (let size = minSize; size <= maxSize; size++) {
        const radius = Math.max(coarse.coarseStep, Math.round(size * 0.18));
        const left = Math.max(0, coarse.x - radius);
        const top = Math.max(0, coarse.y - radius);
        const right = Math.min(width - size, coarse.x + radius);
        const bottom = Math.min(height - size, coarse.y + radius);
        for (let y = top; y <= bottom; y++) {
            for (let x = left; x <= right; x++) {
                const score = scoreAt(x, y, size);
                if (!refined || score > refined.score) refined = { x, y, size, score };
            }
        }
    }
    const match = refined || coarse;
    if (match.score < 0.24) return null;
    return {
        x: match.x, y: match.y, size: match.size,
        width: match.size, height: match.size, confidence: match.score
    };
}
