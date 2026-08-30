"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createOrbScene, type OrbSceneHandle } from "@/lib/orbScene";
import { HandTracker } from "@/lib/handTracker";

type GestureStatus = "off" | "loading" | "ready" | "error" | "no-camera";
type RecordingStatus = "idle" | "recording" | "processing";

function pickSupportedMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "video/webm";
}

export default function UltronOrb() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OrbSceneHandle | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);

  const dragState = useRef({ active: false, lastX: 0, lastY: 0 });

  const [gestureStatus, setGestureStatus] = useState<GestureStatus>("off");
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>("idle");
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  // ---------------------------------------------------------------------
  // Scene lifecycle
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;
    const scene = createOrbScene(containerRef.current, canvasRef.current);
    sceneRef.current = scene;

    const onResize = () => scene.resize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------------
  // Mouse / touch drag to spin, wheel / pinch to zoom
  // ---------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onPointerDown = (e: PointerEvent) => {
      dragState.current.active = true;
      dragState.current.lastX = e.clientX;
      dragState.current.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragState.current.active) return;
      const dx = e.clientX - dragState.current.lastX;
      const dy = e.clientY - dragState.current.lastY;
      dragState.current.lastX = e.clientX;
      dragState.current.lastY = e.clientY;
      sceneRef.current?.applyDrag(dx, dy);
    };
    const onPointerUp = (e: PointerEvent) => {
      dragState.current.active = false;
      canvas.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      sceneRef.current?.applyZoom(e.deltaY * 0.01);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  // ---------------------------------------------------------------------
  // Keyboard shortcuts: G toggle gestures, R reset, +/- zoom
  // ---------------------------------------------------------------------
  const toggleGestures = useCallback(() => {
    setGestureStatus((prev) => (prev === "off" ? "loading" : "off"));
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key.toLowerCase()) {
        case "g":
          toggleGestures();
          break;
        case "r":
          sceneRef.current?.resetView();
          break;
        case "+":
        case "=":
          sceneRef.current?.applyZoom(-0.4);
          break;
        case "-":
        case "_":
          sceneRef.current?.applyZoom(0.4);
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleGestures]);

  // ---------------------------------------------------------------------
  // Hand gesture tracking
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (gestureStatus === "off") {
      trackerRef.current?.stop();
      trackerRef.current = null;
      return;
    }
    if (gestureStatus !== "loading") return;

    const tracker = new HandTracker({
      onSpin: (dx, dy) => sceneRef.current?.applyDrag(dx, dy),
      onZoom: (delta) => sceneRef.current?.applyZoom(delta),
      onStatus: (status) => {
        if (status === "ready") setGestureStatus("ready");
        else if (status === "error") setGestureStatus("error");
        else if (status === "no-camera") setGestureStatus("no-camera");
      },
    });
    trackerRef.current = tracker;
    tracker.start();

    return () => {
      tracker.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gestureStatus === "loading"]);

  useEffect(() => {
    sceneRef.current?.setHudActive(gestureStatus === "ready");
  }, [gestureStatus]);

  // ---------------------------------------------------------------------
  // Session recording — captures the canvas render stream via
  // MediaRecorder and offers the result as a downloadable video.
  // ---------------------------------------------------------------------
  const startRecording = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || recordingStatus !== "idle") return;

    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }

    const stream = canvas.captureStream(30);
    const mimeType = pickSupportedMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    } catch (err) {
      console.error("Recording failed to start", err);
      return;
    }

    recordedChunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      setRecordingStatus("processing");
      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setRecordingStatus("idle");
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    setRecordingStatus("recording");
    setRecordSeconds(0);
    recordTimerRef.current = window.setInterval(() => {
      setRecordSeconds((s) => s + 1);
    }, 1000);
  }, [recordingStatus, downloadUrl]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    if (recordTimerRef.current !== null) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current !== null) clearInterval(recordTimerRef.current);
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      mediaRecorderRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
      .toString()
      .padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  const gestureLabel: Record<GestureStatus, string> = {
    off: "GESTURES OFF",
    loading: "CALIBRATING…",
    ready: "GESTURES ON",
    error: "TRACKER ERROR",
    "no-camera": "CAMERA DENIED",
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        background: "var(--void)",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%", touchAction: "none" }}
      />

      {/* -- Corner frame -- */}
      <div style={hudFrameStyle} aria-hidden="true" />

      {/* -- Title block -- */}
      <div style={titleBlockStyle}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 22, letterSpacing: 4, color: "var(--ash)" }}>
          ULTRON
        </div>
        <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--ember)", marginTop: 2 }}>
          FRACTURED CORE // INTERFACE ACTIVE
        </div>
      </div>

      {/* -- Controls panel -- */}
      <div style={controlsPanelStyle}>
        <button onClick={toggleGestures} style={pillButtonStyle(gestureStatus !== "off")}>
          {gestureLabel[gestureStatus]}
        </button>

        {recordingStatus === "idle" && (
          <button onClick={startRecording} style={pillButtonStyle(false)}>
            ● RECORD
          </button>
        )}
        {recordingStatus === "recording" && (
          <button onClick={stopRecording} style={pillButtonStyle(true)}>
            ■ STOP {formatTime(recordSeconds)}
          </button>
        )}
        {recordingStatus === "processing" && (
          <button disabled style={pillButtonStyle(false)}>
            PROCESSING…
          </button>
        )}

        <button onClick={() => sceneRef.current?.resetView()} style={pillButtonStyle(false)}>
          RESET [R]
        </button>
      </div>

      {downloadUrl && (
        <a
          href={downloadUrl}
          download={`ultron-session-${Date.now()}.webm`}
          style={downloadLinkStyle}
        >
          ⬇ DOWNLOAD RECORDING
        </a>
      )}

      {/* -- Help text -- */}
      <div style={helpTextStyle}>
        DRAG TO SPIN &nbsp;·&nbsp; SCROLL TO ZOOM &nbsp;·&nbsp; [G] GESTURES &nbsp;·&nbsp; [R] RESET
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Inline HUD styling — kept local to this component since it's small
// and tightly coupled to the layout above.
// ---------------------------------------------------------------------

const hudFrameStyle: React.CSSProperties = {
  position: "absolute",
  inset: 16,
  border: "1px solid rgba(122,30,30,0.4)",
  pointerEvents: "none",
};

const titleBlockStyle: React.CSSProperties = {
  position: "absolute",
  top: 32,
  left: 32,
  pointerEvents: "none",
};

const controlsPanelStyle: React.CSSProperties = {
  position: "absolute",
  top: 32,
  right: 32,
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  justifyContent: "flex-end",
  maxWidth: 320,
};

function pillButtonStyle(active: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    letterSpacing: 1.5,
    padding: "8px 14px",
    borderRadius: 2,
    border: `1px solid ${active ? "var(--ember)" : "var(--seam)"}`,
    background: active ? "rgba(212,64,31,0.15)" : "rgba(28,22,19,0.7)",
    color: active ? "var(--ember)" : "var(--ash)",
    cursor: "pointer",
    backdropFilter: "blur(4px)",
  };
}

const downloadLinkStyle: React.CSSProperties = {
  position: "absolute",
  top: 80,
  right: 32,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  letterSpacing: 1.5,
  padding: "8px 14px",
  borderRadius: 2,
  border: "1px solid var(--amber)",
  background: "rgba(214,154,52,0.12)",
  color: "var(--amber)",
  textDecoration: "none",
};

const helpTextStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 28,
  left: "50%",
  transform: "translateX(-50%)",
  fontSize: 10,
  letterSpacing: 1.5,
  color: "var(--ash-dim)",
  pointerEvents: "none",
  whiteSpace: "nowrap",
};
