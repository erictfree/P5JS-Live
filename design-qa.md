# Audio Source Dialog Design QA

## Evidence

- Source visual truth: `design_handoff_audio_source_dialog/p5js live.dc.html`, with the user's explicit `#c1bcf2` hero color and `assets/illustrations/mascot.jpg` full-header image overrides
- Source capture: `/private/tmp/p5js-live-dialog-ref-card.png`
- Implementation: `http://127.0.0.1:5173/?welcome=1`, `.welcome-card`
- Implementation capture: `/private/tmp/p5js-live-dialog-layered-hero-final.jpg`
- Side-by-side comparison: `/private/tmp/p5js-live-dialog-comparison-final.png`
- Default comparison viewport: 720 × 900 CSS px
- Source size: 528 × 808 CSS px and 528 × 808 captured pixels
- Implementation size: 528 × 830 CSS px and 528 × 830 captured pixels
- Density normalization: both component captures were made at 1 captured pixel per CSS pixel, then displayed at the same 264 px comparison width.
- State: initial audio-source dialog; the implementation intentionally focuses the primary action for keyboard access.
- Responsive check: 480 × 800 CSS px; 456 px card; no horizontal overflow; the third action wraps to a new row.

## Findings

- No actionable P0, P1, or P2 differences remain.
- [P3] The handoff loads JetBrains Mono from Google Fonts. The implementation keeps the product's local-first system monospace stack so startup remains dependency-free and the offline bundle makes no external requests. This produces one additional body-copy line and about 22 px of added dialog height. The hierarchy, readability, and compact-dialog intent remain intact.
- The revised 1327 × 1143 mascot image fills the complete 528 × 455 px hero without distortion. The title and subtitle are layered over the image's open upper region.
- The hero fallback is the requested solid `#c1bcf2`; title color, action-panel fill, divider, button fills, borders, radii, padding, gaps, and copy preserve the supplied tokens.
- The introductory copy and Department link match the handoff, with the production link set to `https://aet.utexas.edu/`.
- File, microphone, silence, progress, error, focus, and narrow-width states preserve the existing working behavior.

## Focused Region Review

- Hero: the title, subtitle, and illustration were inspected together at the native 528 px component width and at the 456 px responsive width. The image covers the full hero at both widths with no crop, distortion, or legibility issue.
- Actions: the three controls, helper copy, default focus treatment, wrapping behavior, and 132 px minimum button width were inspected at 528 px and 480 px viewports.
- No icon comparison was needed because this dialog contains no icons beyond the supplied illustration.

## Comparison History

- Pass 1: source and implementation were captured at the same 720 × 900 viewport and combined into one side-by-side comparison. No P0/P1/P2 finding was identified, so no visual correction iteration was required.
- Final check: a second combined comparison confirmed the normal rendered state. The 480 px responsive state and console were also checked; no errors or overflow were present.
- Full-header update: the revised mascot source and the browser-rendered dialog were inspected together. The image measures 1327 × 1143 px, renders at its natural aspect ratio, and exactly matches the hero's 528 × 455 px box. The 480 px check produced a 456 × 393 px hero with no horizontal overflow.
- Type-balance update: the title increased from 40 px to 42 px and the subtitle moved down 4 px. The resulting 10.7 px gap is clear at desktop width; the responsive subtitle wraps cleanly with no card or document overflow.
- Overlay update: the modal scrim opacity was reduced from 0.58 to 0.34, allowing more of the running stage to remain visible while preserving clear separation around the dialog. The existing 3 px backdrop blur and card shadow retain focus.

## Verification

- Unit tests: 197 passed.
- Browser interaction: `enter with silence` dismissed the dialog successfully.
- Browser console errors: none in the default or 480 px checks.

## Implementation Checklist

- [x] Replace the old wide onboarding card with the 528 px three-section dialog.
- [x] Use the supplied mascot asset in the production asset tree.
- [x] Extend the revised mascot image behind the entire hero and layer the heading over it.
- [x] Preserve file, microphone, silence, progress, and error behavior.
- [x] Preserve the real Department link and exact helper copy.
- [x] Verify default and narrow layouts.
- [x] Keep the source handoff and comparison artifacts out of tracked product files.

final result: passed
