const ALPHA_THRESHOLD = 0.002;
const MAX_ALPHA = 0.99;
const LOGO_VALUE = 255;

export function removeWatermark(imageData, alphaMap, position, options = {}) {
    const { x, y, width, height } = position;
    const gain = Number.isFinite(options.alphaGain) && options.alphaGain > 0
        ? options.alphaGain
        : 1;
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const imgIdx = ((y + row) * imageData.width + (x + col)) * 4;
            const alphaIdx = row * width + col;
            let alpha = alphaMap[alphaIdx] * gain;
            if (alpha < ALPHA_THRESHOLD) continue;
            alpha = Math.min(alpha, MAX_ALPHA);
            for (let c = 0; c < 3; c++) {
                const watermarked = imageData.data[imgIdx + c];
                const original = (watermarked - alpha * LOGO_VALUE) / (1.0 - alpha);
                imageData.data[imgIdx + c] = Math.max(0, Math.min(255, Math.round(original)));
            }
        }
    }
}

/**
 * Reconstructs the pixels covered by the sparkle from the surrounding frame.
 * This avoids assuming that the reference PNG is the exact opacity map of the
 * overlay. The mask is limited to the detected template shape.
 */
export function inpaintWatermark(imageData, alphaMap, position, options = {}) {
    const { x = 0, y = 0, width, height } = position;
    const threshold = options.threshold ?? 0.08;
    const iterations = options.iterations ?? 140;
    const frameWidth = imageData.width;
    const data = imageData.data;
    const count = width * height;
    const mask = new Uint8Array(count);
    const red = new Float32Array(count);
    const green = new Float32Array(count);
    const blue = new Float32Array(count);

    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const i = row * width + col;
            mask[i] = alphaMap[i] >= threshold ? 1 : 0;
            const p = ((y + row) * frameWidth + (x + col)) * 4;
            red[i] = data[p];
            green[i] = data[p + 1];
            blue[i] = data[p + 2];
        }
    }

    // Laplace relaxation: masked pixels converge toward the average of their
    // unmasked boundary. Separate buffers avoid scan-direction artifacts.
    const nextR = new Float32Array(count);
    const nextG = new Float32Array(count);
    const nextB = new Float32Array(count);
    for (let pass = 0; pass < iterations; pass++) {
        nextR.set(red); nextG.set(green); nextB.set(blue);
        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                const i = row * width + col;
                if (!mask[i]) continue;
                let sr = 0, sg = 0, sb = 0, weights = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue;
                        const nx = col + dx, ny = row + dy;
                        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                        const ni = ny * width + nx;
                        const weight = dx && dy ? 0.7071 : 1;
                        sr += red[ni] * weight;
                        sg += green[ni] * weight;
                        sb += blue[ni] * weight;
                        weights += weight;
                    }
                }
                if (weights) {
                    nextR[i] = sr / weights;
                    nextG[i] = sg / weights;
                    nextB[i] = sb / weights;
                }
            }
        }
        red.set(nextR); green.set(nextG); blue.set(nextB);
    }

    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const i = row * width + col;
            if (!mask[i]) continue;
            const p = ((y + row) * frameWidth + (x + col)) * 4;
            data[p] = Math.round(red[i]);
            data[p + 1] = Math.round(green[i]);
            data[p + 2] = Math.round(blue[i]);
        }
    }
    return imageData;
}
