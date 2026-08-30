import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";

/**
 * handTracker — wraps MediaPipe's HandLandmarker over a live webcam feed
 * and turns raw landmarks into two gestures:
 *
 *  - One hand pinched (thumb tip + index tip close together) and moving
 *    -> spin the orb, proportional to hand movement.
 *  - Both hands pinched simultaneously, distance between them changing
 *    -> zoom in/out.
 *
 * Pinch detection uses hysteresis (different enter/exit thresholds) so a
 * hand hovering right at the pinch boundary doesn't flicker the gesture
 * state on and off every frame.
 */

const PINCH_ENTER = 0.055; // normalized distance to START a pinch
const PINCH_EXIT = 0.08; // normalized distance to END a pinch (must open wider)

export interface HandTrackerCallbacks {
  onSpin: (dx: number, dy: number) => void;
  onZoom: (delta: number) => void;
  onStatus?: (status: "loading" | "ready" | "error" | "no-camera") => void;
}

interface HandState {
  pinching: boolean;
  lastX: number | null;
  lastY: number | null;
}

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private rafId = 0;
  private running = false;
  private callbacks: HandTrackerCallbacks;

  private handStates: [HandState, HandState] = [
    { pinching: false, lastX: null, lastY: null },
    { pinching: false, lastX: null, lastY: null },
  ];
  private lastTwoHandDistance: number | null = null;

  constructor(callbacks: HandTrackerCallbacks) {
    this.callbacks = callbacks;
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;
  }

  async start(): Promise<void> {
    this.callbacks.onStatus?.("loading");
    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
      );
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "/models/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
    } catch (err) {
      console.error("HandTracker: failed to load model", err);
      this.callbacks.onStatus?.("error");
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
    } catch (err) {
      console.error("HandTracker: camera access denied", err);
      this.callbacks.onStatus?.("no-camera");
      return;
    }

    this.video.srcObject = this.stream;
    await this.video.play();

    this.running = true;
    this.callbacks.onStatus?.("ready");
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.handStates = [
      { pinching: false, lastX: null, lastY: null },
      { pinching: false, lastX: null, lastY: null },
    ];
    this.lastTwoHandDistance = null;
  }

  private loop = () => {
    if (!this.running || !this.landmarker) return;
    if (this.video.readyState >= 2) {
      const result = this.landmarker.detectForVideo(this.video, performance.now());
      this.processResult(result);
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  private dist(ax: number, ay: number, bx: number, by: number): number {
    return Math.hypot(ax - bx, ay - by);
  }

  private processResult(result: HandLandmarkerResult): void {
    const hands = result.landmarks ?? [];

    // Update pinch state per hand (up to 2), with hysteresis.
    const pinchPoints: { x: number; y: number }[] = [];

    for (let i = 0; i < 2; i++) {
      const landmarks = hands[i];
      const state = this.handStates[i];
      if (!landmarks) {
        state.pinching = false;
        state.lastX = null;
        state.lastY = null;
        continue;
      }
      const thumbTip = landmarks[4];
      const indexTip = landmarks[8];
      const pinchDist = this.dist(thumbTip.x, thumbTip.y, indexTip.x, indexTip.y);

      if (!state.pinching && pinchDist < PINCH_ENTER) {
        state.pinching = true;
        state.lastX = null;
        state.lastY = null;
      } else if (state.pinching && pinchDist > PINCH_EXIT) {
        state.pinching = false;
        state.lastX = null;
        state.lastY = null;
      }

      if (state.pinching) {
        const midX = (thumbTip.x + indexTip.x) / 2;
        const midY = (thumbTip.y + indexTip.y) / 2;
        pinchPoints.push({ x: midX, y: midY });

        if (pinchPoints.length === 1) {
          // handled below once we know if it's the only pinch
          state.lastX = midX;
          state.lastY = midY;
        }
      }
    }

    const pinchingCount = this.handStates.filter((s) => s.pinching).length;

    if (pinchingCount === 2 && pinchPoints.length === 2) {
      // Two-hand pinch -> zoom based on change in distance between hands.
      const d = this.dist(
        pinchPoints[0].x,
        pinchPoints[0].y,
        pinchPoints[1].x,
        pinchPoints[1].y
      );
      if (this.lastTwoHandDistance !== null) {
        const delta = (this.lastTwoHandDistance - d) * 10;
        if (Math.abs(delta) > 0.001) {
          this.callbacks.onZoom(delta);
        }
      }
      this.lastTwoHandDistance = d;
    } else {
      this.lastTwoHandDistance = null;

      if (pinchingCount === 1) {
        // Single-hand pinch -> spin, based on frame-to-frame movement.
        const idx = this.handStates.findIndex((s) => s.pinching);
        const state = this.handStates[idx];
        const landmarks = hands[idx];
        if (landmarks) {
          const thumbTip = landmarks[4];
          const indexTip = landmarks[8];
          const midX = (thumbTip.x + indexTip.x) / 2;
          const midY = (thumbTip.y + indexTip.y) / 2;

          if (state.lastX !== null && state.lastY !== null) {
            const dx = (midX - state.lastX) * 400;
            const dy = (midY - state.lastY) * 400;
            this.callbacks.onSpin(dx, dy);
          }
          state.lastX = midX;
          state.lastY = midY;
        }
      }
    }
  }
}
