---
name: 小说转剧本工作台 (Novel-to-Screenplay Workbench)
description: An ink-and-cinnabar manuscript workbench that turns novels into structured, editable screenplay drafts.
colors:
  cinnabar: "#b23a30"
  cinnabar-deep: "#8f2c25"
  ink: "#211b16"
  ink-soft: "#4a4036"
  ink-faint: "#8c8071"
  paper: "#f4efe4"
  paper-panel: "#fbf8f1"
  paper-recessed: "#efe8d8"
  rule: "#d8cfbd"
  rule-soft: "#e6ddcb"
  jade: "#5a6f5a"
  gold: "#a6802f"
  danger: "#a3342b"
  seal-foil: "#f7ede0"
typography:
  display:
    fontFamily: "Noto Serif SC, Songti SC, SimSun, serif"
    fontSize: "26px"
    fontWeight: 900
    lineHeight: 1.1
    letterSpacing: "0.03em"
  headline:
    fontFamily: "Noto Serif SC, Songti SC, SimSun, serif"
    fontSize: "19px"
    fontWeight: 800
    lineHeight: 1.3
    letterSpacing: "0.04em"
  title:
    fontFamily: "Noto Serif SC, Songti SC, SimSun, serif"
    fontSize: "16.5px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.14em"
  body:
    fontFamily: "Noto Serif SC, Songti SC, SimSun, serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.95
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono, Cascadia Code, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.28em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "13px"
  md: "18px"
  lg: "24px"
  xl: "30px"
components:
  button-primary:
    backgroundColor: "{colors.cinnabar}"
    textColor: "{colors.seal-foil}"
    rounded: "{rounded.md}"
    padding: "9px 15px"
  button-primary-hover:
    backgroundColor: "{colors.cinnabar-deep}"
    textColor: "{colors.seal-foil}"
    rounded: "{rounded.md}"
    padding: "9px 15px"
  button-default:
    backgroundColor: "{colors.paper-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "9px 15px"
  panel:
    backgroundColor: "{colors.paper-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "11px"
    padding: "18px"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.pill}"
    padding: "4px 11px"
  tab-active:
    backgroundColor: "{colors.paper-recessed}"
    textColor: "{colors.ink}"
    rounded: "0px"
    padding: "14px 16px"
---

# Design System: 小说转剧本工作台

## 1. Overview

**Creative North Star: "The Editor's Desk"**

This is a working manuscript desk rendered in software. The surface is warm rice paper
(`#f4efe4`); the type is a Chinese serif set for long-form reading; the single mark of
authority is a vermilion correction seal (`#b23a30`), used the way a senior editor uses
a red pen, sparingly, and only where it carries meaning. Everything is in service of one
act: reading a generated screenplay and marking it up with confidence. The chrome is the
margin; the script is the manuscript.

The system is **literary, trustworthy, and effortless**. It earns its cultural character
through restraint, not costume. The heritage shows up as material (paper, ink, seal) and
as typographic care, never as ornament for its own sake. Density is calm: generous line
height (1.95 for body), centered screenplay blocks capped near 40–62ch, and quiet hairline
rules (`#d8cfbd`) instead of heavy borders or boxes. Color does real work: cinnabar means
"emphasis / accent", jade (`#5a6f5a`) means "faithful / passed", gold (`#a6802f`) means
"inferred / low confidence". A reader can decode the screenplay's trustworthiness from hue
alone.

This system **explicitly rejects** three things. It is not a generic SaaS dashboard:
no blue accent, no uniform card grid, no Inter-everywhere template; the cultural identity
is the entire point of difference. It is not heavy skeuomorphic kitsch: no faux torn paper,
no dragon motifs, no "ancient scroll" theme-park clichés or calligraphy overload that fight
legibility; the brush script (`Ma Shan Zheng`) is confined to a single seal glyph and
nowhere else. And it is not cluttered: no dense toolbars, no competing accents, no visual
noise that pulls the eye off the script. The stated direction is **keep but modernize**:
hold the ink/cinnabar identity, but lighten the texture and tighten the UI over time.

**Key Characteristics:**
- Rice-paper warmth with a single vermilion accent; everything else is ink and hairline.
- Semantic color: cinnabar = emphasis, jade = faithful, gold = inferred.
- Serif-led, long-form-reading typography; mono reserved for labels, meta, and code.
- Refined and restrained surfaces; depth appears only on interaction.
- The generated screenplay is always the hero; chrome recedes to the margins.

## 2. Colors

A warm-neutral paper field carrying one saturated editorial accent, plus a small
semantic pair (jade / gold) that encodes trust and inference.

### Primary
- **Cinnabar Seal** (`#b23a30`): The single voice of authority. Used on the primary
  button, the brand seal, the active tab underline, scene numbers, kickers, and accent
  chips. It is the red pen of the editor's desk; its scarcity is what makes it read as
  important. **Cinnabar Deep** (`#8f2c25`) is its pressed/hover state. **Cinnabar Wash**
  (`rgba(178,58,48,0.10)`) tints annotation callouts and accent chips.

### Secondary
- **Jade** (`#5a6f5a`): The "faithful / passed" signal. Completed pipeline steps,
  validation success, and the confidence meter's filled segments. Calm, never alarming.
- **Gold** (`#a6802f`): The "inferred / low-confidence" signal. Running steps, inference
  badges, and warning chips. Tells the writer "the tool guessed here", honestly.

### Neutral
- **Ink** (`#211b16`): Primary text and the masthead's structural 2px rule. Maximum
  legibility against paper.
- **Ink Soft** (`#4a4036`): Secondary text, body prose in cards, descriptions.
- **Ink Faint** (`#8c8071`): Tertiary text, meta, captions, placeholders. NOTE: at
  `#8c8071` on `#f4efe4` this falls below WCAG AA 4.5:1; see Do's and Don'ts.
- **Paper** (`#f4efe4`): The body field, the manuscript surface.
- **Paper Panel** (`#fbf8f1`): Raised panels and default buttons; one step lighter.
- **Paper Recessed** (`#efe8d8`): Sunken zones, the tab strip, action bars.
- **Rule** (`#d8cfbd`) / **Rule Soft** (`#e6ddcb`): Hairline dividers and borders. The
  structure is carried by thin lines, not boxes or shadows.
- **Seal Foil** (`#f7ede0`): The warm off-white used as text ON cinnabar and ink fills
  (button labels, role badges), so the foil reads like ink stamped on a seal.

### Named Rules
**The One Seal Rule.** Cinnabar is the only saturated accent on any screen, and it stays
under ~10% of the surface. If two things are both red, neither reads as the emphasis.
Jade and gold are semantic signals, not decoration: never use them to "add color".

## 3. Typography

**Display / Body Font:** Noto Serif SC (with Songti SC, SimSun, serif)
**Label / Mono Font:** JetBrains Mono (with Cascadia Code, monospace)
**Seal Glyph Only:** Ma Shan Zheng (brush script, restricted to the single brand seal)

**Character:** One serif carries the entire reading experience, from the masthead title
to screenplay dialogue, in a range of weights (400→900). The contrast comes from weight
and scale, not from competing typefaces. A monospace handles anything that is "machine"
(labels, scene meta, confidence readouts, YAML, code), which reinforces the human/serif
vs. system/mono distinction. The brush script appears exactly once, as the seal mark.

### Hierarchy
- **Display** (900, 26px, lh 1.1, ls 0.03em): Screenplay front-matter title; the loudest
  type on the page. Deliberately capped near 26–29px: this is a desk, not a billboard.
- **Headline** (800, 19px, ls 0.04em): Character names, timeline events, masthead title.
- **Title** (700, 16.5px, ls 0.14em): Scene slug-lines, centered like a real shooting
  script.
- **Body** (400, 14.5px, lh 1.95): Action and prose. Centered screenplay blocks capped at
  40ch (dialogue) to 62ch (action / narration) for comfortable reading.
- **Label** (500, 11px, ls 0.28em, UPPERCASE/mono): Panel headers, eyebrows, meta rows,
  badges. Short strings only.

### Named Rules
**The One Family Rule.** The serif does all the reading work in multiple weights. Do not
introduce a second serif or sans for "variety". The mono is functional (machine voice),
not a second display face.
**The Brush-Is-A-Seal Rule.** Ma Shan Zheng is confined to the 60px brand seal glyph.
Never set headings, labels, or body copy in brush script; it is unreadable at those sizes
and tips the whole system into kitsch.

## 4. Elevation

The system is **refined and restrained**: nearly flat at rest, with structure carried by
hairline rules and tonal paper layering (paper → panel → recessed), not by shadow. Depth
is a response to interaction, not a default state. Two soft, low-contrast shadows exist for
raised surfaces and hover lift; both are warm-tinted (ink, not black) so they sit in the
paper world.

### Shadow Vocabulary
- **Soft** (`box-shadow: 0 1px 2px rgba(33,27,22,0.05), 0 8px 24px -12px rgba(33,27,22,0.18)`):
  Resting elevation for panels. Barely there; signals "raised surface", not "floating card".
- **Lift** (`box-shadow: 0 2px 6px rgba(33,27,22,0.07), 0 20px 50px -20px rgba(33,27,22,0.3)`):
  Hover-only, for character cards. Pairs with a 3px upward translate.

### Named Rules
**The Tonal-Depth Rule.** Layering is done with paper tones and hairlines first, shadow
second. A surface that needs separating gets a `#d8cfbd` rule or a tone step before it gets
a shadow. Shadows never stack and never go darker than the Lift token.

## 5. Components

Refined and restrained throughout: quiet surfaces, hairline borders, one accent, motion
only on interaction (160–200ms on the `cubic-bezier(0.16,1,0.3,1)` ease).

### Buttons
- **Shape:** Gently rounded (8px / `rounded.md`).
- **Primary:** Cinnabar fill (`#b23a30`) with seal-foil text (`#f7ede0`), padding 9px 15px.
  The committed action (载入示例 / 开始转换).
- **Default:** Paper-panel fill (`#fbf8f1`) with a `#d8cfbd` border and ink text; the quiet
  secondary action.
- **Hover:** Primary deepens to `#8f2c25`; default shifts its border to ink-faint and lifts
  1px. **Disabled:** 45% opacity, no lift.
- **Focus:** MUST show a visible focus ring (currently missing; see Don'ts).

### Chips
- **Style:** Pill (`999px`), hairline `#d8cfbd` border on paper, ink-soft text.
- **Variants:** `accent` (cinnabar border + wash + mono) for stats; `warn` (gold) for
  open-question / low-confidence counts. The chip's color is its meaning.

### Cards / Containers
- **Corner Style:** 11px (cards), 12px (panels). Never above 16px; rounder reads as
  generic SaaS, not manuscript.
- **Background:** Cards on `#f4efe4`, panels on `#fbf8f1`. **Border:** single hairline
  `#d8cfbd` (full border, never a side stripe). **Padding:** 18px.
- **Shadow Strategy:** Panels rest on Soft; cards are flat at rest and rise to Lift +
  `translateY(-3px)` on hover. See Elevation.

### Inputs / Fields
- **Style:** The novel textarea is borderless and sits directly on the panel paper, like
  writing on the page itself; the panel frame provides the boundary.
- **Focus:** MUST be visible. The current `outline: none` with no replacement is an
  accessibility defect; a focus treatment (ring or inner border on the panel) is required.
- **Placeholder:** ink-faint; must meet 4.5:1 (see Don'ts).

### Navigation (Tabs)
- **Style:** Text tabs on the recessed paper strip (`#efe8d8`); serif, ls 0.04em. Inactive
  ink-faint; hover → ink; **active** ink + 700 weight + 2px cinnabar underline, with a mono
  count in cinnabar. The active tab is the only place the underline accent appears.

### Pipeline Stepper (Signature Component)
- A vertical list of the 7 conversion steps (safety review → parse → analyze → aggregate →
  scenes → validate → safety review). Each step shows a state glyph: idle (hairline ring),
  running (gold ring, spinning), done (jade fill), failed (danger fill). This is the trust
  surface, it makes the pipeline's honesty visible. The spinner MUST have a reduced-motion
  alternative (see Don'ts).

## 6. Do's and Don'ts

### Do:
- **Do** keep cinnabar as the single accent under ~10% of any screen (The One Seal Rule).
- **Do** use jade for "faithful/passed" and gold for "inferred/low-confidence" semantically;
  the confidence meter and step states depend on this color language.
- **Do** carry all reading type in one serif across weights 400–900; reserve mono for the
  machine voice (labels, meta, YAML, code).
- **Do** build structure from hairline rules (`#d8cfbd`) and paper tone steps before reaching
  for a shadow (The Tonal-Depth Rule).
- **Do** cap screenplay reading blocks at 40ch (dialogue) to 62–75ch (prose).
- **Do** add a visible `:focus-visible` treatment to every button, tab, and the textarea,
  and an `@media (prefers-reduced-motion: reduce)` alternative for the spinner, pulse dots,
  hover lifts, and `.view` reveal. These are committed accessibility requirements.
- **Do** darken `--ink-faint` toward the ink end of the ramp wherever it carries body or
  placeholder text, until it clears 4.5:1 on its paper background.

### Don't:
- **Don't** ship it as a generic SaaS dashboard: no blue accent, no uniform icon+heading
  card grid, no Inter-everywhere template. The cultural identity is the point of difference.
- **Don't** drift into skeuomorphic kitsch: no faux torn paper, dragon motifs, ancient-scroll
  clichés, or brush script anywhere but the single seal glyph (The Brush-Is-A-Seal Rule).
- **Don't** clutter: no dense toolbars, no second saturated accent competing with cinnabar,
  no visual noise that pulls the eye off the generated script.
- **Don't** round cards or panels above 16px, and don't pair a 1px border with a wide soft
  drop-shadow on the same element (the ghost-card look); pick a hairline OR a defined shadow.
- **Don't** use a colored `border-left`/`border-right` stripe as an accent on callouts or
  cards (the current `.annot` 2px cinnabar left-stripe should migrate to a full hairline +
  wash). Full borders, background tint, or a leading mark instead.
- **Don't** strip focus outlines without an equal-or-better replacement; `outline: none`
  alone is a defect.
- **Don't** set ink-faint gray text on tinted paper for anything a reader must actually read;
  it washes out and fails contrast.
