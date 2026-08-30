# ultron-orb-ui

A fractured, molten wireframe intelligence core built with Three.js — drag,
scroll, or use hand gestures to interrogate it. Includes on-screen session
recording.

## Setup

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

### Hand landmark model

Hand gesture tracking needs MediaPipe's hand-landmark model file at
`public/models/hand_landmarker.task`. It isn't bundled here (binary, and this
environment has no network access to fetch it). Download it yourself:

```bash
curl -L -o public/models/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
```

Everything else (mouse/touch drag-to-spin, scroll-to-zoom, recording) works
without it.

## Controls

### Mouse / touch

| Input | Action |
| --- | --- |
| Drag | Spin the orb |
| Scroll / pinch | Zoom in & out |

### Hand gestures (webcam)

Click **GESTURES OFF** (or press `G`) and allow camera access, then:

| Gesture | Action |
| --- | --- |
| Pinch (thumb + index) one hand and move it | Spin the orb |
| Pinch with **both** hands, spread apart / bring together | Zoom in / out |

### Keyboard

| Key | Action |
| --- | --- |
| `G` | Toggle hand gestures |
| `R` | Reset the view |
| `+` / `−` | Zoom in / out |

## Recording

Click **● RECORD** in the top-right panel to start capturing the live canvas
(via `canvas.captureStream()` + `MediaRecorder`) as WebM video at 30fps.
Click **■ STOP** to end the capture — a **⬇ DOWNLOAD RECORDING** link appears
once the file is ready. No server round-trip; everything happens in-browser
and the recording exists only as a local blob URL for that session.

## How it works

- **`lib/orbScene.ts`** — the Three.js scene: layered wireframe shells, a spiral
  inner core, floating code-text sprites, orbiting debris, dust particles, scan
  rings, and a bloom + chromatic-aberration post-processing stack.
- **`lib/handTracker.ts`** — MediaPipe HandLandmarker running on the webcam
  feed. Pinch detection with hysteresis: one pinched hand spins the orb, two
  pinched hands zoom by spreading apart or together.
- **`components/JarvisOrb.tsx`** — the HUD, input glue, and the recording
  controls, wiring the scene, tracker, and your inputs together.
