# Design history

This file records reversible visual experiments whose previous values would otherwise
be difficult to recover from the interface alone. Source history remains authoritative.

## 2026-08-23 — Robot mascot restored

The public-site hero and instrument welcome dialog again use
`site/assets/hero-bot-3.png`, with the original robot sizing and responsive positions
recorded below. The Mascot 2 source and served assets remain in the repository so the
trial can be restored without recreating or locating the artwork.

## 2026-08-23 — Mascot 2 experiment

### Previous visible mascot

- Asset: `site/assets/hero-bot-3.png`
- Dimensions: 1254 × 1254 PNG with transparency
- Character: white robot at a laptop with headphones
- Public-site hero:
  - image container: `flex: 0 1 460px; min-width: 320px`
  - image: `width: 100%; height: auto; object-fit: contain`
- Instrument welcome dialog:
  - hero height: `244px`
  - image width: `280px`
  - maximum width: `68%`
  - position: `right: -8px; bottom: -4px`
  - narrow-screen position: `right: -24px`
- Open Graph, Twitter card, and JSON-LD image: `hero-bot-3.png`, 1254 × 1254

The previous asset remains in place and can be restored by changing the two visible
image sources back to `/assets/hero-bot-3.png` and restoring the dialog values above.

### Mascot 2 trial

- Original supplied asset: `assets/illustrations/mascot2.png`
- Served copy: `site/assets/mascot2.png`
- Dimensions: 1230 × 1278 PNG with transparency
- Public-site hero keeps the existing responsive container and `contain` behavior.
- Instrument dialog trial:
  - image width: `225px`
  - maximum width: `48%`
  - position: `right: 10px; bottom: -2px`
  - narrow-screen position: `right: 2px`
  - at `430px` and below: `240px` hero, `145px` image at `right: 8px;
    bottom: 0`, and subtitle width limited to `180px`
- Social sharing metadata intentionally continues using `hero-bot-3.png` until the
  visible trial is accepted.
