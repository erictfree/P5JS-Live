# Tools UI review

Inspected the running localhost app at its current 595 × 852 browser viewport. No project source or runtime parameters were changed.

1. Library — needs hierarchy improvements. Screenshot 01-library.png. Explicit source/add/run workflow is useful. Instructions, demo insertion and sharing precede browsing; category lists start halfway down the viewport. Prioritize search and filters, move patch sharing to contextual actions, keep one concise workflow hint. Six tabs occupy two rows. Labels truncate at this width.
2. Project — functional but mixed responsibilities. Screenshot 02-project.png. Performance saving and safe recovery are grouped visibly. Project file actions also contain FPS warning, drawer opacity and code size; move these to Settings. Reset appears beside routine import/export. Give reset a separate explicit action. Keep performance recall in the main navigation.
3. Controllers — needs priority and sizing improvements. Screenshot 03-controls.png. Live values and MIDI mapping are adjacent, but setup text and device connection precede actual controls. checkerSpeed truncates and slider is squeezed into one row. Rename to Controls; show full name and value above a full-width slider, with mapping details secondary. The continuous slider has no accessible name in both the live accessibility tree and src/ui/panels.js paramRow source; fix association.

Proposed navigation: Library, Controls, Audio, Performances as primary sections; Messages, AI setup and interface preferences in a secondary group or More menu. Preserve direct access to active errors and AI editing. Move audience layout beside Audience in the main toolbar. Prefer readable near-opaque drawer backing, stronger selected-tab treatment, responsive full-width narrow-screen drawer, explicit Close, remembered section and per-section scroll positions.

Implementation order: readable/responsive shell and control labels; Library search and hierarchy; reorganize settings and contextual actions; review keyboard behavior and long-content states. Maintain explicit Run behavior for source changes.

Limits: this is an inspection of three panels at the current narrow viewport, with targeted source inspection. No hardware MIDI, screen reader or full keyboard compliance test was performed. Performance improvements are design hypotheses pending use testing.

## Detailed panel mockups

Open `panels.html` for the interactive panel study. The original review links to it. It includes Library, Controls, Audio, Performances, and secondary Settings, Messages, and AI views. Wide and Compact controls change the mock panel width. All data and device states are illustrative; the prototype imports no instrument modules, uses no browser storage, and does not access audio, MIDI, or AI services.

Verified in the browser: patch search and empty-state recovery; install → add → review → run states; slider adjustment; creating a sample parameter; accessible MIDI mapping actions; audio playback and input-source states; saving and recalling a performance; restoring a safe state; settings feedback; and the example AI proposal. Compact and desktop layouts were visually inspected. JavaScript syntax validation passed. The mockup export downloads sample JSON, not a live project file.
