<img width="2560" height="1393" alt="image" src="https://github.com/user-attachments/assets/13cb47a2-ced3-4021-84c1-7addad6c5bae" /># 🎵 Spicetify Spicy Lyrics Vinyl-Player

A [Spicetify](https://spicetify.app) extension that turns your album art into a spinning vinyl record — inspired by the rotating disc in Instagram stories. The disc rotates as your song plays, and you can grab and spin it to scrub through the track.

---

## Features

- **Spinning album art** — the artwork rotates continuously as the song progresses, completing 4 full revolutions over the duration of a track
- **Vinyl-style scrubbing** — click and drag the artwork clockwise to skip forward, counter-clockwise to go back, just like spinning a record
- **Live timeline sync** — the progress bar and timestamp update in real time as you drag, so you always know where you're landing
- **Pause on drag** — playback pauses while you scrub and resumes from the new position when you let go
- **Non-destructive** — all buttons and controls in the now-playing bar (heart, queue, next track, etc.) continue to work normally
- **DOM-resilient** — Spotify frequently destroys and recreates player elements on song changes; a `MutationObserver` automatically reattaches everything when that happens

---

## Screenshots
<img width="2560" height="1440" alt="image" src="https://github.com/user-attachments/assets/9ddcfcfb-34d9-428e-be98-b296ce304bf1" />
<img width="2560" height="1393" alt="image" src="https://github.com/user-attachments/assets/7ba1551b-3b40-43b9-a4ff-ef3c680c480e" />
<img width="2560" height="1393" alt="image" src="https://github.com/user-attachments/assets/001b150b-4c37-4177-9aa2-652c1f164863" />


## Installation

### Prerequisites

- [Spicetify CLI](https://spicetify.app/docs/getting-started) installed and configured
- Node.js 18+
- Spicy Lyrics Extension 

### Steps

1. Clone or download this repository into your Spicetify extensions folder:

   ```bash
   cd "$(spicetify -c | xargs dirname)/Extensions"
   git clone https://github.com/yourusername/spicetify-vinyl-spin
   ```

2. Copy `app.tsx` (or the compiled `app.js`) into the Extensions folder directly if you're not using a custom app — or set it up as a custom app by placing it in the CustomApps folder and registering it in your Spicetify config.

3. Apply and restart:

   ```bash
   spicetify apply
   ```

### Building from source

If you're working with the TypeScript source:

```bash
npm install
npm run build
```

Then copy the output into your Spicetify extensions folder and run `spicetify apply`.

---

## Configuration

A few constants at the top of `app.tsx` can be tuned to taste:

| Constant | Default | Description |
|---|---|---|
| `ROTATIONS_PER_SONG` | `10` | How many full spins the disc makes over a complete track |
| `DRAG_DEGREES_PER_TRACK` | `3600` | Total degrees of drag gesture = full track length. Lower = more sensitive |
| `DRAG_THRESHOLD_PX` | `4` | Pixel distance before a click becomes a drag |

---

## How it works

### Rotation

A `requestAnimationFrame` loop reads `Spicetify.Player.getProgress()` and `getDuration()` on every frame, maps the 0–1 fraction to `0 → (ROTATIONS_PER_SONG × 360)°`, and applies it as a CSS `transform: rotate()` on `.MediaImageContainer`.

### Scrubbing

`pointerdown` is attached to `.MediaBox` (the full now-playing area) but immediately hit-tested against `.MediaImageContainer`'s bounding rect — so only clicks on the artwork itself engage drag mode, leaving all other controls untouched.

During a drag, the cursor angle relative to the disc center is computed on each `pointermove`. Rather than comparing against a fixed start angle (which breaks past 180°), the delta is accumulated **incrementally** frame-to-frame. Each tiny per-frame step is always well under 180°, so wrap-around is handled cleanly and full multi-revolution scrubs work correctly.

The rAF loop is fully stopped for the duration of the drag so it can't overwrite the drag-controlled rotation. On release, the loop restarts from the committed seek position.

### Timeline sync

During drag, `updateTimeline()` directly mutates the Spotify DOM — setting `--SliderProgress` on `.SliderBar` and updating `.Time.Position`'s text content — without calling `seek()`, so there are no audio glitches mid-drag.

### DOM resilience

A `MutationObserver` watches `.Root__now-playing-bar` (falling back to `<body>`) and calls `bindElements()` whenever the subtree changes. Element references are compared before re-attaching, so listeners are never duplicated.

---

## Compatibility

Tested against Spotify desktop with Spicetify and Spicy Lyrics. Because the extension targets Spicy Lyrics's internal class names (`.MediaImageContainer`, `.MediaBox`, `.SliderBar`, `.Time.Position`), a Spicy Lyrics update that renames these classes will break the relevant feature until the names are updated in the source.

---

## License

MIT
