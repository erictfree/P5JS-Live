# Handoff: p5js live — Audio Source Start Dialog

## Overview
A start screen / popup dialog for the "p5js live" app. It introduces the tool and lets the user pick how the visuals should be driven: an audio file, the microphone, or silence (a "just launch" option). Intended to appear as a small in-browser dialog / app-start screen, not a full page.

## About the Design Files
The file in this bundle (`p5js live.dc.html`) is a **design reference built in HTML** — it shows the intended look and behavior, not production code to copy directly. Recreate this design in the target codebase's existing environment (React, Vue, plain JS, etc.) using its established components and patterns. If no environment exists yet, choose the most appropriate framework and implement it there.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and copy are final as shown. Recreate pixel-close using the target codebase's component library where one exists.

## Screens / Views

### Screen: Start Dialog
**Purpose:** Onboarding/start screen shown before the visualizer runs; user picks an audio source.

**Layout:** Single column, max-width ~528px, centered. Three stacked sections, no outer card border — meant to sit inside a browser popup / small window:
1. Header/hero panel (lavender gradient background)
2. Body copy panel (white background)
3. Action panel (light lavender-gray background)

**Components (top to bottom):**

1. **Hero panel**
   - Background: `linear-gradient(180deg, #b9c1e8 0%, #cfd3ea 100%)`
   - Padding: 31px sides, 0 bottom
   - Title "p5js live": font-size 40px, weight 800, letter-spacing 3px, color `#5b3fa6`, monospace font
   - Subtitle "AUDIO-REACTIVE VISUAL LIVE CODING IN THE BROWSER": font-size 13px, weight 700, letter-spacing 1.5px, color `#2a2a3a`, uppercase
   - Hero illustration image (`assets/mascot-illustration.png`): full width, block, small border-radius. Cartoon robot-with-headphones mascot over a pink/blue audio waveform with music notes.

2. **Body copy panel**
   - Background: white, padding 22px/31px/13px/31px
   - Paragraph, font-size 15px, line-height 1.55, color `#1a1a1a`
   - Text: "p5js live is a browser-based visual instrument for live-coding audio-reactive graphics with JavaScript and p5.js. It was created by Eric Freeman at the Department of Arts and Entertainment Technologies at the University of Texas at Austin."
   - "Department of Arts and Entertainment Technologies" is a link, color `#5b3fa6` (href currently `#` — needs a real URL)

3. **Divider**: 1px line, color `#ddd8e8`, 7px vertical margin, 31px horizontal margin

4. **Action panel**
   - Background: `#f2eef6`, padding 20px/31px/22px/31px
   - Label "Choose what the visuals should respond to:" — font-size 14px, weight 700
   - Row of 3 buttons, flex, gap 11px, wrap on narrow widths, each `flex: 1`, min-width 132px:
     - **Primary — "choose audio file"**: background `#c81856`, text white, weight 700, 2px solid border `#7a0f36`, border-radius 7px
     - **Secondary — "use microphone"**: background white, text `#1a1a1a`, weight 500, 2px solid border `#cfc9dc`, border-radius 7px
     - **Secondary — "enter with silence"**: same style as "use microphone"
     - All buttons: font-size 14px, padding 12px/11px, monospace font, cursor pointer
   - Helper text below buttons: "Choose an audio file (.mp3, .wav, .ogg, .m4a, or .aac), microphone, or silence to begin." — font-size 11px, color `#6a6478`

## Interactions & Behavior
- **choose audio file**: opens a native file picker restricted to audio types (.mp3, .wav, .ogg, .m4a, .aac); on selection, loads the file as the audio source and proceeds to the visualizer.
- **use microphone**: requests mic permission (`getUserMedia`); on grant, uses the mic stream as the audio source and proceeds.
- **enter with silence**: proceeds directly to the visualizer with no audio input (visuals idle/static or driven by a silent buffer).
- No hover/active states specified in the mock — use standard button press/hover feedback consistent with the target app.
- Dialog is intended to be compact enough to fit a small browser popup window (~480–560px wide).

## State Management
- Selected audio source mode: `'file' | 'microphone' | 'silence' | null`
- File object (when mode is `'file'`)
- Microphone permission/stream state (when mode is `'microphone'`)
- Error state for: file type rejected, mic permission denied

## Design Tokens
**Colors:**
- Hero gradient: `#b9c1e8` → `#cfd3ea`
- Title purple: `#5b3fa6`
- Body text / dark: `#1a1a1a`, `#2a2a3a`
- Action panel background: `#f2eef6`
- Divider: `#ddd8e8`
- Primary button: `#c81856` (fill), `#7a0f36` (border)
- Secondary button border: `#cfc9dc`
- Helper text: `#6a6478`

**Typography:** JetBrains Mono (Google Fonts), weights 400/500/700/800. All text on this screen is monospace.

**Spacing scale used:** 7px, 11px, 13px, 20px, 22px, 31px

**Border radius:** 6–7px on buttons and the hero image

## Assets
- `assets/mascot-illustration.png` — cartoon robot-with-headphones mascot over an audio waveform with music notes, cropped from a user-provided AI-generated image. Treat as a placeholder/final illustration asset to drop into the codebase's asset pipeline as-is (already cropped, no baked-in text).

## Files
- `p5js live.dc.html` — the full design reference (open directly in a browser to view)
- `assets/mascot-illustration.png` — hero illustration asset
