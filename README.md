# Brand Watermark Studio

A mobile-first, browser-based watermark workspace. Media is processed locally in your browser; this static site has no upload backend and uses no paid API.

## Current implementation
- Gemini sparkle image remover: reverse-alpha blend using public reference masks from the MIT-licensed upstream project at https://github.com/dearabhin/gemini-watermark-remover. It targets the standard bottom-right 48px / 96px mark layout.
- Add a custom logo to images and video. Image export is PNG. Video export uses browser MediaRecorder and WebM where supported.
- Responsive mobile-first dark interface.

## Important limitations
- Removal only targets the standard visible Gemini sparkle mark in its expected location and size. Other placements, compact variants, modified images, scaling, or different backgrounds can leave artifacts. Always inspect the result.
- Reverse-alpha reconstructs pixels from the expected overlay model; it is not general-purpose inpainting.
- Video logo export is real-time and depends on browser MediaRecorder, canvas capture, codec support, device memory, and audio capture support. Test on a short clip first.
- This app does not remove invisible SynthID, metadata, or other provenance signals.
- Use only media you own or have permission to edit.

## Publish
Enable GitHub Pages from Settings → Pages → Deploy from a branch → main → /(root). No build step is required.

## License
The UI and application glue are provided under MIT. The two Gemini sparkle reference masks are copied from the MIT-licensed upstream project linked above.
