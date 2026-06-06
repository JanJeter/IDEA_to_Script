# Product

## Register

product

## Users

Web-novel and amateur fiction writers adapting their own serialized, multi-chapter
stories into screenplay drafts. They are creators first, not industry professionals:
comfortable with long-form prose, less interested in formal screenplay tooling.

Context of use: at a desk, mid-writing-session, pasting chapters of their own novel
and wanting a structured, editable first draft back fast. They care about speed, low
cost (the tool runs without an API key via mock mode), faithful extraction of their
story, and output they can read and hand-edit. They are not running a production
pipeline; they want a trustworthy starting point they can refine.

## Product Purpose

Convert multi-chapter novel text into a structured, schema-valid, re-editable YAML
screenplay draft. A deterministic five-step pipeline (chapter parsing → per-chapter
analysis → character/world summary → scene generation → assembly + schema validation)
turns prose into characters, locations, a timeline, scenes, dialogue, action,
narration, transitions, adaptation notes, and open questions.

Success looks like: a writer pastes three or more chapters, watches the pipeline run,
and gets back a screenplay they trust enough to keep editing, with the tool honest
about what it inferred or compressed (adaptation notes + open questions) rather than
silently inventing plot.

## Brand Personality

Three words: **literary, trustworthy, effortless.**

Voice and tone: a respectful editor, not a flashy app. Cultured but practical;
confident about the craft of adaptation without being precious about it. The Chinese
ink-and-cinnabar "manuscript / 台本" identity is a deliberate differentiator that signals
care for the written word, but it always serves reading and editing rather than
showing off. The interface should feel calm, legible, and quick to get out of the
writer's way.

## Anti-references

- **Generic SaaS dashboard.** No blue-accent, card-grid, Inter-everywhere AI-tool
  template. The cultural identity is the entire point of difference; do not flatten it
  into a stock product UI.
- **Heavy skeuomorphic kitsch.** No faux torn paper, dragon motifs, "ancient scroll"
  theme-park clichés, or calligraphy overload that hurts usability. The heritage is a
  refined accent, not a costume.
- **Cluttered / overstimulating.** No dense toolbars, competing accents, or visual
  noise that distracts from reading the generated script. The output is the hero.

Stated visual intent: **keep but modernize** the ink/cinnabar theme — retain the
cultural identity, but favor a cleaner, more contemporary execution (less texture and
skeuomorphism, tighter UI) over the current heavier treatment.

## Design Principles

1. **The script is the hero.** Every layout and color decision optimizes reading and
   editing the generated screenplay. Chrome recedes; output comes forward.
2. **Honest about inference.** The tool distinguishes what it extracted faithfully from
   what it inferred or compressed. Adaptation notes, confidence meters, and open
   questions are first-class, never buried.
3. **Heritage in service of legibility.** The ink/cinnabar identity earns its place
   only where it aids hierarchy or meaning. When character and readability conflict,
   readability wins.
4. **Effortless trust.** Pipeline state, mock-vs-live mode, and validation results are
   always visible and plainly worded, so the writer trusts the process without reading
   docs.
5. **Modern restraint.** Prefer one committed accent and clean structure over layered
   texture and decoration. Modernize the theme rather than thicken it.

## Accessibility & Inclusion

Target: **WCAG 2.2 AA.**

- **Contrast.** Body and placeholder text must hit ≥4.5:1 against their background;
  large/bold text ≥3:1. Audit the muted-ink-on-paper ramp (`--ink-faint`, `--ink-soft`
  on `--paper`/`--paper-2`) — several muted tones are likely below AA and must be
  darkened toward the ink end of the ramp.
- **Reduced motion.** Honor `prefers-reduced-motion: reduce` for the pipeline spinners,
  view reveal animations, hover lifts, and pulse dots — provide crossfade/instant
  alternatives.
- **Keyboard & screen reader.** Tabs, buttons, the toolbar, and the pipeline stepper
  must be fully keyboard-operable with visible focus states and correct roles/labels,
  so the conversion flow is usable without a mouse and announced by assistive tech.
