# Jad Daou — Photography Portfolio

Next.js implementation of the `Jad Daou Portfolio.dc.html` design from Claude Design.

```bash
npm install
npm run dev      # http://localhost:3000
```

## What's here

A single-page portfolio that renders one of two ways, chosen at runtime:

- **Immersive** — a scroll-driven Three.js journey. A 460vh sticky track maps
  scroll position onto a camera path that pushes through the hero, sweeps a
  wall of six photographs, and settles into the About plane. HTML overlays
  cross-fade on top, driven from the render loop.
- **Flat** — a conventional hero → masonry grid → about layout, used when WebGL
  is unavailable *or* the visitor prefers reduced motion.

### Forcing a mode

`prefers-reduced-motion` is the **default**, not a lock — it is often enabled
for performance rather than vestibular reasons (on Windows, turning off
"animation effects" sets it), and that would otherwise hide the 3D gallery with
no way to ask for it.

| URL                | Effect                                     |
| ------------------ | ------------------------------------------ |
| `/?motion=full`    | Force the immersive 3D path                |
| `/?motion=reduced` | Force the flat path                        |
| `/`                | Follow the OS setting                      |

The choice persists in `localStorage` under `jd:motion`. Clear that key to go
back to following the OS. **If the 3D scene isn't showing locally, check this
first** — WebGL failing is far less likely than the motion preference.

Both share the booking section (packages, availability calendar, inquiry form),
footer, and lightbox.

## Layout

```
app/
  layout.tsx              fonts + metadata
  page.tsx
  globals.css             design tokens, resets, keyframes
  api/inquiries/route.ts  booking form endpoint
components/portfolio/
  Portfolio.tsx           orchestrator — mode selection, shared state
  Journey.tsx             3D track and its overlays
  StaticShowcase.tsx      flat hero / grid / about
  Booking.tsx             packages, calendar, inquiry form
  Lightbox.tsx  SiteHeader.tsx  SiteFooter.tsx
  Atmosphere.tsx          loader, film grain, custom cursor
  ImageSlot.tsx  CategoryFilter.tsx
  portfolio.module.css    one stylesheet for the page
lib/portfolio/
  scene.ts                Three.js scene, camera path, hover, wipe transition
  content.ts              categories, captions, packages, contact
  images.ts               slot id → photograph source
  availability.ts         calendar construction + booking rules
  hooks.ts                useInView, useTilt, motion/pointer preferences
  scroll.ts               waypoint scrolling
```

## Before this goes live

Three things are deliberately stubbed, each marked in the source:

1. **No photographs.** The design used fillable placeholder slots, so none
   shipped with it. Add sources to `IMAGE_SOURCES` in `lib/portfolio/images.ts`,
   keyed by slot id (`portfolio-<category>-<0..5>`, `hero-image`,
   `about-portrait`). Slots render a labelled placeholder until then, in both
   the grid and as textures on the 3D wall.
2. **Availability is fake.** `lib/portfolio/availability.ts` blocks weekends
   plus a few hardcoded dates. Point it at the real schedule.
3. **Inquiries go nowhere.** `app/api/inquiries/route.ts` validates and logs the
   submission, then returns success. Wire the marked `TODO` to email or a
   database before accepting real bookings — otherwise submissions are accepted
   and dropped.

Contact details in `lib/portfolio/content.ts` (`hello@jaddaou.com`, the phone
number, the social links) came from the design and are placeholders too.

## Settings

`<Portfolio />` accepts the three knobs the design exposed as editor props:

| Prop                 | Default | Effect                                  |
| -------------------- | ------- | --------------------------------------- |
| `grainIntensity`     | `0.05`  | Film grain opacity (0–0.15)             |
| `parallaxIntensity`  | `0.3`   | Pointer/scroll parallax strength (0–0.6)|
| `customCursor`       | `true`  | Custom pointer on fine-pointer devices  |
