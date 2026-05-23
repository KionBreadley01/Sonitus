import { useEffect, useRef } from "react";

export type VisualMode = "bars" | "circle" | "wave" | "particles" | "universe" | "psycho" | "arc3d" | "fractal";

interface Props {
  analyser: AnalyserNode | null;
  mode: VisualMode;
  playing: boolean;
  fractalOverride?: number | null;
  onFractalChange?: (index: number) => void;
  allowedFractals?: number[];
}

class Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; hue: number;
  constructor(x: number, y: number, hue: number, speedMult = 1) {
    this.x = x; this.y = y; this.hue = hue;
    const angle = Math.random() * Math.PI * 2;
    const speed = (Math.random() * 2.5 + 0.8) * speedMult;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.maxLife = Math.random() * 100 + 50;
    this.life = this.maxLife;
    this.size = Math.random() * 3.5 + 0.8;
  }
  update() { this.x += this.vx; this.y += this.vy; this.vx *= 0.97; this.vy *= 0.97; this.life--; }
  draw(ctx: CanvasRenderingContext2D) {
    const alpha = Math.max(0, this.life / this.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `hsl(${this.hue},100%,65%)`;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

const dynHue = (h: number) => ((h % 360) + 360) % 360;
const avg = (a: Uint8Array, s: number, e: number) => {
  let sum = 0; const end = Math.min(e, a.length);
  for (let i = s; i < end; i++) sum += a[i];
  return sum / (end - s);
};

export const Visualizer = ({ analyser, mode, playing, fractalOverride, onFractalChange, allowedFractals }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>();
  const particlesRef = useRef<Particle[]>([]);
  const hueShiftRef = useRef(0);
  const lastBassRef = useRef(0);
  // ARC3D State
  const arc3dHeightsRef = useRef<number[]>(new Array(48).fill(0));
  const arc3dRotationRef = useRef(0);
  const mandalaRotationRef = useRef(0);
  // Pre-allocated buffers — never recreated during animation
  const freqBufRef = useRef<Uint8Array | null>(null);
  const timeBufRef = useRef<Uint8Array | null>(null);
  const timeRef = useRef<number>(0);
  const randomOffsetRef = useRef<number>(Math.floor(Math.random() * 10000));
  // Synced refs — loop reads these directly so it never needs to restart on prop changes
  const modeRef = useRef(mode);
  const playingRef = useRef(playing);
  const analyserRef = useRef(analyser);
  const fractalOverrideRef = useRef(fractalOverride);
  const onFractalChangeRef = useRef(onFractalChange);
  const allowedFractalsRef = useRef(allowedFractals || [0,1,2,3,4,5,6,7,8]);
  const lastReportedFractalRef = useRef<number | null>(null);

  // Keep refs in sync with props on every render
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { analyserRef.current = analyser; }, [analyser]);
  useEffect(() => { fractalOverrideRef.current = fractalOverride ?? null; }, [fractalOverride]);
  useEffect(() => { onFractalChangeRef.current = onFractalChange; }, [onFractalChange]);
  useEffect(() => { allowedFractalsRef.current = allowedFractals && allowedFractals.length > 0 ? allowedFractals : [0,1,2,3,4,5,6,7,8]; }, [allowedFractals]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    particlesRef.current = [];
    hueShiftRef.current = 0;
    lastBassRef.current = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    // Fix fullscreen exit: canvas doesn't auto-resize on fullscreenchange
    const onFSChange = () => { setTimeout(resize, 50); };
    document.addEventListener("fullscreenchange", onFSChange);

    let frame = 0;
    let isActive = true;
    let lastTimestamp: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // Hybrid RAF + setTimeout loop.
    // Browsers throttle requestAnimationFrame when another window overlaps
    // (even in fullscreen). We use a parallel setTimeout at ~60fps as a
    // heartbeat so the visualizer never freezes regardless of window focus.
    const TARGET_FPS = 60;
    const TARGET_FRAME_MS = 1000 / TARGET_FPS;

    let rafScheduled = false;

    const scheduleFrame = () => {
      if (!isActive) return;
      if (!rafScheduled) {
        rafScheduled = true;
        rafRef.current = requestAnimationFrame((ts) => {
          rafScheduled = false;
          draw(ts);
        });
      }
    };

    const heartbeat = () => {
      if (!isActive) return;
      // Fire a frame via RAF; if RAF is being throttled the draw call
      // below via setTimeout will still run within ~16ms.
      scheduleFrame();
      timeoutId = setTimeout(heartbeat, TARGET_FRAME_MS);
    };

    const draw = (timestamp: number) => {
      if (!isActive) return;

      const dtMs = lastTimestamp === null ? 0 : Math.min(timestamp - lastTimestamp, 100);
      lastTimestamp = timestamp;
      // Scale: ~0.012 per frame at 60fps ≈ 0.72/s
      timeRef.current += dtMs * 0.00072;
      const time = timeRef.current;
      frame++;

      // Read live values from refs — no loop restart needed on prop change
      const mode = modeRef.current;
      const playing = playingRef.current;
      const fractalOverride = fractalOverrideRef.current;
      const analyser = analyserRef.current;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const cx = w / 2, cy = h / 2;

      if (mode === "arc3d") {
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(0, 0, w, h);
        const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.6);
        bgGrad.addColorStop(0, "#001133");
        bgGrad.addColorStop(1, "transparent");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);
      } else {
        // Particles mode needs faster fade to clear sparkles drawn each frame
        const trailAlpha = mode === "psycho" ? 0.13 : mode === "particles" ? 0.3 : 0.2;
        ctx.fillStyle = `rgba(5,4,12,${trailAlpha})`;
        ctx.fillRect(0, 0, w, h);
      }

      if (!analyser) return;

      const bufLen = analyser.frequencyBinCount;

      // Reuse buffers
      if (!freqBufRef.current || freqBufRef.current.length !== bufLen) {
        freqBufRef.current = new Uint8Array(bufLen);
        timeBufRef.current = new Uint8Array(bufLen);
        // Initialize time domain to silence (128)
        timeBufRef.current.fill(128);
      }
      const fdata = freqBufRef.current as Uint8Array<ArrayBuffer>;
      const tdata = timeBufRef.current as Uint8Array<ArrayBuffer>;
      
      if (playing) {
        analyser.getByteFrequencyData(fdata);
        if (analyser.getByteTimeDomainData) analyser.getByteTimeDomainData(tdata);
      } else {
        // Smoothly decay all data when paused instead of freezing abruptly
        for (let i = 0; i < bufLen; i++) {
          // Frequency data drops to 0
          if (fdata[i] > 0) fdata[i] = Math.max(0, fdata[i] - 4);
          
          // Time domain data flattens to 128
          if (tdata[i] > 128) tdata[i] = Math.max(128, tdata[i] - 4);
          else if (tdata[i] < 128) tdata[i] = Math.min(128, tdata[i] + 4);
        }
      }

      const bass = avg(fdata, 0, 10);
      const mid = avg(fdata, 10, 60);
      const treble = avg(fdata, 60, 180);
      const energy = (bass + mid + treble) / 3 / 255;

      // Accumulate smooth monotonic rotation (smooths out jitter completely!)
      const rotationSpeedMultiplier = 1.0 + (mid / 255) * 1.5;
      mandalaRotationRef.current += dtMs * 0.001 * rotationSpeedMultiplier;
      const mandalaRot = mandalaRotationRef.current;

      // Dynamic hue — accumulate beat kicks + slow time drift
      const delta = bass - lastBassRef.current;
      if (delta > 16) hueShiftRef.current += delta * 0.75;
      lastBassRef.current = bass;
      hueShiftRef.current += 0.22;

      const BH = hueShiftRef.current % 360;
      const H0 = dynHue(BH);
      const H1 = dynHue(BH + 90);
      const H2 = dynHue(BH + 180);
      const H3 = dynHue(BH + 270);

      ctx.lineCap = "round";

      // ─── BARS — Segmented LED style ────────────────────────────────────
      if (mode === "bars") {
        const renderers = [
          () => {}, () => {}, () => {}, () => {}, () => {},
          () => {}, () => {}, () => {}, () => {}, () => {},
          () => {}, () => {}, () => {}
        ];
        const bars = 64;                       // number of bar columns
        const step = Math.floor(bufLen / bars);
        const barW = (w / bars) * 0.72;        // bar column width
        const gap = (w / bars) * 0.28;        // gap between columns
        const segH = 6;                        // each LED block height
        const segGap = 2;                        // gap between blocks
        const segTotal = segH + segGap;            // total height per segment
        const maxSegs = Math.floor(h * 0.88 / segTotal); // max segments that fit

        ctx.shadowBlur = 0;

        for (let i = 0; i < bars; i++) {
          const v = fdata[i * step] / 255;
          if (v < 0.01) continue;
          const activeSeg = Math.round(v * maxSegs); // how many lit segments
          const x = i * (barW + gap) + gap / 2;

          // Rainbow hue from left (pink ~300°) → right (blue ~240°)
          // Maps 0..bars → full spectrum: red→yellow→green→cyan→blue→purple
          const barHue = (i / bars) * 300; // 0=red(0°) → 300=magenta(300°)

          for (let s = 0; s < activeSeg; s++) {
            // Bottom segment = darkest, top = brightest
            const segFrac = s / maxSegs;   // 0=bottom, 1=top
            const y = h - (s + 1) * segTotal + segGap;

            // Brightness increases toward top
            const lit = 45 + segFrac * 35;
            const alpha = 0.7 + segFrac * 0.3;

            ctx.fillStyle = `hsla(${barHue},100%,${lit}%,${alpha})`;

            // Glow only on top few segments (expensive, so limit)
            if (s >= activeSeg - 3) {
              ctx.shadowBlur = 10 + segFrac * 18;
              ctx.shadowColor = `hsl(${barHue},100%,70%)`;
            } else {
              ctx.shadowBlur = 0;
            }

            ctx.fillRect(x, y, barW, segH);
          }

          // Top "peak" bright cap segment
          if (activeSeg > 0) {
            const peakY = h - (activeSeg + 1) * segTotal + segGap;
            ctx.fillStyle = `hsl(${barHue},100%,90%)`;
            ctx.shadowBlur = 16; ctx.shadowColor = `hsl(${barHue},100%,80%)`;
            ctx.fillRect(x, peakY, barW, segH);
          }
        }
        ctx.shadowBlur = 0;

        // ─── CIRCLE ────────────────────────────────────────────────────────
      } else if (mode === "circle") {
        const minD = Math.min(w, h);
        const baseR = minD * 0.18 + bass / 5;
        const slices = 180; // reduced from 256

        ctx.lineWidth = 2;
        for (let i = 0; i < slices; i++) {
          const v = fdata[Math.floor((i / slices) * bufLen * 0.5)] / 255;
          if (v < 0.03) continue;
          const len = v * minD * 0.42;
          const ang = (i / slices) * Math.PI * 2 + time * 0.55;
          const iHue = dynHue(BH + (i / slices) * 360);
          const x1 = cx + Math.cos(ang) * baseR;
          const y1 = cy + Math.sin(ang) * baseR;
          const x2 = cx + Math.cos(ang) * (baseR + len);
          const y2 = cy + Math.sin(ang) * (baseR + len);
          ctx.strokeStyle = `hsla(${iHue},100%,65%,${0.65 + v * 0.35})`;
          ctx.shadowBlur = 10 + v * 18;
          ctx.shadowColor = `hsl(${iHue},100%,65%)`;
          ctx.lineWidth = 1.5 + v * 2.5;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }
        // Pulsing core orb
        const orbR = baseR * 0.7;
        ctx.shadowBlur = 45 + bass * 0.4; ctx.shadowColor = `hsl(${H2},100%,70%)`;
        ctx.fillStyle = `hsla(${H1},100%,65%,${0.25 + energy * 0.7})`;
        ctx.beginPath(); ctx.arc(cx, cy, orbR, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

      // ─── WAVE — NEW DESIGN: filled terrain layers ───────────────────────
      } else if (mode === "wave") {
        // Downsample for performance
        const pts = Math.min(bufLen, 512);
        const stepW = w / (pts - 1);
        const layers = 4;

        for (let layer = layers - 1; layer >= 0; layer--) {
          const layerFrac = layer / layers;           // 0=front, 1=back
          const layerHue = dynHue(BH + layer * 90);
          const depthAlpha = 0.45 + (1 - layerFrac) * 0.45; // front more opaque
          const heightMult = 0.28 + (1 - layerFrac) * 0.18; // front taller
          const timeOff = time * (0.6 + layer * 0.35);
          const yBase = h * (0.55 + layerFrac * 0.12); // front lower

          ctx.beginPath();
          ctx.moveTo(0, h);

          for (let i = 0; i < pts; i++) {
            const td = tdata[Math.floor(i * bufLen / pts)] / 128.0 - 1;
            const extra = Math.sin(i * 0.04 + timeOff) * 0.12;
            const y = yBase + (td + extra) * h * heightMult * (1 + energy * 0.6);
            ctx.lineTo(i * stepW, y);
          }
          ctx.lineTo(w, h);
          ctx.closePath();

          // Filled gradient from wave line down to bottom
          const grad = ctx.createLinearGradient(0, yBase - h * heightMult, 0, h);
          grad.addColorStop(0, `hsla(${layerHue},100%,70%,${depthAlpha})`);
          grad.addColorStop(0.35, `hsla(${dynHue(layerHue + 30)},100%,50%,${depthAlpha * 0.75})`);
          grad.addColorStop(1, `hsla(${layerHue},100%,20%,0)`);
          ctx.fillStyle = grad;

          // Glow on top edge
          ctx.shadowBlur = 18 + energy * 25;
          ctx.shadowColor = `hsl(${layerHue},100%,65%)`;
          ctx.fill();

          // Re-draw just the top line for crisp glow edge
          ctx.beginPath();
          for (let i = 0; i < pts; i++) {
            const td = tdata[Math.floor(i * bufLen / pts)] / 128.0 - 1;
            const extra = Math.sin(i * 0.04 + timeOff) * 0.12;
            const y = yBase + (td + extra) * h * heightMult * (1 + energy * 0.6);
            if (i === 0) ctx.moveTo(0, y); else ctx.lineTo(i * stepW, y);
          }
          ctx.strokeStyle = `hsla(${layerHue},100%,80%,${0.5 + (1 - layerFrac) * 0.4})`;
          ctx.lineWidth = 2 + (1 - layerFrac) * 2;
          ctx.shadowBlur = 22 + energy * 30;
          ctx.shadowColor = `hsl(${layerHue},100%,75%)`;
          ctx.stroke();
        }

        // Horizontal centre mirror line
        ctx.beginPath();
        ctx.strokeStyle = `hsla(${H3},100%,70%,0.08)`;
        ctx.lineWidth = 1; ctx.shadowBlur = 0;
        ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
        ctx.shadowBlur = 0;

        // ─── PARTICLES ─────────────────────────────────────────────────────
      } else if (mode === "particles") {
        // Central burst — fires on almost any bass signal
        if (bass > 70) {
          const count = Math.min(Math.floor((bass / 255) * 30) + 8, 45);
          for (let i = 0; i < count; i++) {
            particlesRef.current.push(
              new Particle(cx, cy, dynHue(BH + Math.random() * 360), energy * 5 + 1.5)
            );
          }
        }

        // Background mini-explosions on strong bass hits
        if (bass > 160 && frame % 10 === 0) {
          // Generate 1 to 3 random explosions
          const numExplosions = 1 + Math.floor(Math.random() * 3);
          for (let e = 0; e < numExplosions; e++) {
            // Pick a random point anywhere on screen
            const ex = Math.random() * w;
            const ey = Math.random() * h;
            const eHue = dynHue(BH + Math.random() * 360);
            const particleCount = 10 + Math.floor(energy * 15);

            for (let i = 0; i < particleCount; i++) {
              const angle = Math.random() * Math.PI * 2;
              const speed = (Math.random() * 5 + 2) * (1 + energy);
              const p = new Particle(ex, ey, eHue, energy * 3 + 1);
              p.vx = Math.cos(angle) * speed;
              p.vy = Math.sin(angle) * speed;
              p.size = Math.random() * 4 + 1.5;
              p.maxLife = 30 + Math.random() * 40;
              p.life = p.maxLife;
              particlesRef.current.push(p);
            }
          }
        }

        // Mid-frequency: more scatter particles from orbit ring
        if (mid > 60) { // balanced threshold
          const edgeCount = Math.floor(mid / 28) + 2; // balanced particle count
          for (let i = 0; i < edgeCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r = Math.min(w, h) * (0.15 + Math.random() * 0.30); // slightly tighter spawn area
            particlesRef.current.push(
              new Particle(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r,
                dynHue(BH + 180 + Math.random() * 180), energy * 5 + 1.2) // slightly slower
            );
          }
        }

        // ── ORBITAL RINGS — continuous particles circling the orb ──────
        // 3 concentric rings at different radii, always spawning
        const orbR = 35 + bass * 0.4;
        const ringRadii = [orbR * 1.6, orbR * 2.4, orbR * 3.5];
        const ringSpawnRates = [2, 3, 2]; // frames between spawns per ring

        for (let ri = 0; ri < ringRadii.length; ri++) {
          if (frame % ringSpawnRates[ri] === ri) {
            const spawnCount = 2 + Math.floor(energy * 4);
            for (let s = 0; s < spawnCount; s++) {
              const angle = Math.random() * Math.PI * 2;
              const r = ringRadii[ri] + (Math.random() - 0.5) * orbR * 0.4;
              const px = cx + Math.cos(angle) * r;
              const py = cy + Math.sin(angle) * r;
              const oHue = dynHue(BH + ri * 90 + Math.random() * 60);

              const p = new Particle(px, py, oHue, 0.4);
              // Tangential velocity (perpendicular to radius) = clockwise orbit
              const tangSpeed = 0.6 + energy * 1.8 + ri * 0.3;
              p.vx = -Math.sin(angle) * tangSpeed + (Math.random() - 0.5) * 0.5;
              p.vy = Math.cos(angle) * tangSpeed + (Math.random() - 0.5) * 0.5;
              p.size = 1.5 + Math.random() * 3.5 + energy * 3;
              p.maxLife = 40 + Math.random() * 50 + ri * 20;
              p.life = p.maxLife;
              particlesRef.current.push(p);
            }
          }
        }

        // Dense mini-ring right at orb surface that pulses with bass
        if (frame % 1 === 0) {
          const surfaceCount = Math.floor(bass / 60) + 1;
          for (let s = 0; s < surfaceCount; s++) {
            const angle = (s / surfaceCount + time * 0.5) * Math.PI * 2;
            const r = orbR * (1.1 + Math.random() * 0.4);
            const px = cx + Math.cos(angle) * r;
            const py = cy + Math.sin(angle) * r;
            const sHue = dynHue(BH + (angle / (Math.PI * 2)) * 360);
            const p = new Particle(px, py, sHue, 0.3);
            p.vx = (Math.random() - 0.5) * (1 + energy * 3);
            p.vy = (Math.random() - 0.5) * (1 + energy * 3);
            p.size = 1 + Math.random() * 2.5 + energy * 2;
            p.maxLife = 20 + Math.random() * 25;
            p.life = p.maxLife;
            particlesRef.current.push(p);
          }
        }

        // ── TREBLE SPARKLES — draw only every 12 frames to avoid burn-in ──
        if (treble > 145 && frame % 12 === 0) {
          const sparkCount = Math.min(Math.floor((treble / 255) * 6) + 2, 8);
          for (let i = 0; i < sparkCount; i++) {
            const sx = Math.random() * w;
            const sy = Math.random() * h;
            const sHue = dynHue(BH + Math.random() * 360);
            const sR = 3 + Math.random() * 7 + energy * 5;

            ctx.save();
            ctx.translate(sx, sy);
            ctx.globalAlpha = 0.6 + Math.random() * 0.35;
            ctx.shadowBlur = 20 + sR * 1.5;
            ctx.shadowColor = `hsl(${sHue},100%,80%)`;
            ctx.fillStyle = `hsl(${sHue},100%,85%)`;
            ctx.fillRect(-sR * 2.2, -sR * 0.3, sR * 4.4, sR * 0.6);
            ctx.fillRect(-sR * 0.3, -sR * 2.2, sR * 0.6, sR * 4.4);
            ctx.shadowBlur = 14;
            ctx.fillStyle = `hsl(${sHue},100%,98%)`;
            ctx.beginPath(); ctx.arc(0, 0, sR * 0.45, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          }
        }

        // ── RANDOM SIDE EFFECTS — edges come alive ──────────────────────
        // Side lightning streaks — less frequent
        if (energy > 0.45 && frame % 18 === 0) {
          const side = Math.random() > 0.5 ? 0 : w;
          const streakY = Math.random() * h;
          const len = (0.08 + Math.random() * 0.2) * w * (Math.random() > 0.5 ? 1 : -1);
          const sHue = dynHue(BH + Math.random() * 180);
          ctx.save();
          ctx.strokeStyle = `hsla(${sHue},100%,80%,${0.4 + energy * 0.4})`;
          ctx.shadowBlur = 14 + energy * 18;
          ctx.shadowColor = `hsl(${sHue},100%,70%)`;
          ctx.lineWidth = 1 + energy * 2;
          ctx.beginPath();
          ctx.moveTo(side, streakY);
          for (let z = 0; z < 4; z++) {
            ctx.lineTo(side + len * ((z + 1) / 4) + (Math.random() - 0.5) * 30,
              streakY + (Math.random() - 0.5) * 60);
          }
          ctx.stroke();
          ctx.restore();
        }

        // Corner flares — bright diagonal explosions from corners
        if (bass > 170 && frame % 8 === 0) {
          const corners = [[0, 0], [w, 0], [0, h], [w, h]];
          const corner = corners[Math.floor(Math.random() * corners.length)];
          const cHue = dynHue(BH + Math.random() * 360);
          const rays = 8 + Math.floor(Math.random() * 6);
          for (let r = 0; r < rays; r++) {
            // Aim inward from corner
            const baseAngle = Math.atan2(cy - corner[1], cx - corner[0]);
            const spread = (Math.PI / 3);
            const angle = baseAngle + (Math.random() - 0.5) * spread;
            const rayLen = (0.2 + Math.random() * 0.35) * Math.min(w, h);
            ctx.save();
            ctx.strokeStyle = `hsla(${dynHue(cHue + r * 15)},100%,75%,${0.4 + Math.random() * 0.5})`;
            ctx.shadowBlur = 18 + energy * 20;
            ctx.shadowColor = `hsl(${cHue},100%,75%)`;
            ctx.lineWidth = 1 + Math.random() * 2.5;
            ctx.beginPath();
            ctx.moveTo(corner[0], corner[1]);
            ctx.lineTo(corner[0] + Math.cos(angle) * rayLen, corner[1] + Math.sin(angle) * rayLen);
            ctx.stroke();
            ctx.restore();
          }
        }

        // Floating orbs from sides — smaller and more subtle
        if (mid > 155 && frame % 12 === 0) {
          const ox = Math.random() > 0.5 ? -5 : w + 5;
          const oy = Math.random() * h;
          const oHue = dynHue(BH + Math.random() * 360);
          const p = new Particle(ox, oy, oHue, 0.3 + Math.random());
          p.vx = ox < 0 ? (Math.random() * 1.5 + 0.4) : -(Math.random() * 1.5 + 0.4);
          p.vy = (Math.random() - 0.5) * 1;
          p.size = 3 + Math.random() * 5;     // much smaller
          p.maxLife = 80 + Math.random() * 60;
          p.life = p.maxLife;
          particlesRef.current.push(p);
        }

        // Pulsing central orb with 3 layers
        const og = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR * 1.5);
        og.addColorStop(0, `hsla(${H1},100%,95%,0.98)`);
        og.addColorStop(0.3, `hsla(${H0},100%,70%,0.8)`);
        og.addColorStop(0.65, `hsla(${H3},100%,50%,0.4)`);
        og.addColorStop(1, `hsla(${H2},100%,30%,0)`);
        ctx.shadowBlur = 60 + bass * 0.5; ctx.shadowColor = `hsl(${H0},100%,75%)`;
        ctx.fillStyle = og;
        ctx.beginPath(); ctx.arc(cx, cy, orbR * 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        // Draw & update particles
        const arr = particlesRef.current;
        for (let i = arr.length - 1; i >= 0; i--) {
          const p = arr[i]; p.update(); p.draw(ctx);
          if (p.life <= 0 || p.x < -40 || p.x > w + 40 || p.y < -40 || p.y > h + 40)
            arr.splice(i, 1);
        }
        if (arr.length > 1000) arr.splice(0, 150);

        // ─── UNIVERSE ──────────────────────────────────────────────────────
      } else if (mode === "universe") {
        const slices = 110; // reduced
        ctx.shadowBlur = 0;
        for (let i = 0; i < slices; i++) {
          const v = fdata[i] / 255;
          if (v < 0.02) continue;
          const iHue = dynHue(BH + (i / slices) * 360);
          const r = v * Math.min(w, h) * 0.5;
          const ang = (i / slices) * Math.PI * 2 + time * 0.5 + v * 2.5;
          const x = cx + Math.cos(ang) * r;
          const y = cy + Math.sin(ang) * r;

          ctx.fillStyle = `hsl(${iHue},100%,${55 + v * 30}%)`;
          ctx.beginPath(); ctx.arc(x, y, 2 + v * 8, 0, Math.PI * 2); ctx.fill();

          if (i > 0 && v > 0.5 && frame % 2 === 0) {
            const pAng = ((i - 1) / slices) * Math.PI * 2 + time * 0.5 + (fdata[i - 1] / 255) * 2.5;
            const pR = (fdata[i - 1] / 255) * Math.min(w, h) * 0.5;
            ctx.strokeStyle = `hsla(${iHue},100%,65%,${v * 0.5})`;
            ctx.lineWidth = 1; ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(cx + Math.cos(pAng) * pR, cy + Math.sin(pAng) * pR);
            ctx.stroke();
          }
        }

        // ─── PSYCHO ────────────────────────────────────────────────────────
      } else if (mode === "psycho") {
        const bp = bass / 255;
        const minD = Math.min(w, h);

        // Tunnel rings
        const rings = 18;
        for (let r = 0; r < rings; r++) {
          const t = (r / rings + time * (0.12 + bp * 0.38)) % 1;
          const radius = t * minD * 0.78;
          const rHue = dynHue(BH + r * (360 / rings));
          ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, radius), 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${rHue},100%,55%,${(1 - t) * (0.25 + bp * 0.5)})`;
          ctx.shadowColor = `hsl(${rHue},100%,65%)`;
          ctx.shadowBlur = 18 + bp * 30;
          ctx.lineWidth = 2.5 + (1 - t) * 6 * bp;
          ctx.stroke();
        }

        // Spiral arms (only every other frame for perf)
        const arms = 4;
        for (let arm = 0; arm < arms; arm++) {
          const armOff = (arm / arms) * Math.PI * 2;
          const pts = 160; // reduced
          ctx.beginPath();
          for (let p = 0; p < pts; p++) {
            const frac = p / pts;
            const angle = armOff + frac * Math.PI * 7 + time * (1.1 + bp * 0.9);
            const fv = fdata[Math.floor(frac * bufLen * 0.6)] / 255;
            const radius = frac * minD * 0.45 * (0.65 + fv * 0.65);
            const x = cx + Math.cos(angle) * radius;
            const y = cy + Math.sin(angle) * radius;
            if (p === 0) { ctx.moveTo(x, y); continue; }
            ctx.lineTo(x, y);
            if (p % 20 === 19) {
              const sHue = dynHue(BH + arm * 90 + frac * 150);
              ctx.strokeStyle = `hsla(${sHue},100%,60%,${0.7 + fv * 0.3})`;
              ctx.shadowColor = `hsl(${sHue},100%,60%)`; ctx.shadowBlur = 12 + fv * 18;
              ctx.lineWidth = 1.5 + fv * 3.5; ctx.stroke();
              ctx.beginPath(); ctx.moveTo(x, y);
            }
          }
          ctx.stroke();
        }

        // Kaleidoscope burst (every frame)
        const segs = 60; // reduced from 72
        for (let i = 0; i < segs; i++) {
          const v = fdata[Math.floor((i / segs) * bufLen * 0.5)] / 255;
          if (v < 0.04) continue;
          const sHue = dynHue(BH + (i / segs) * 360);
          const ang = (i / segs) * Math.PI * 2 - time * 0.5;
          const inner = minD * 0.04;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
          ctx.lineTo(cx + Math.cos(ang) * (inner + v * minD * 0.38), cy + Math.sin(ang) * (inner + v * minD * 0.38));
          ctx.strokeStyle = `hsla(${sHue},100%,65%,${0.55 + v * 0.45})`;
          ctx.shadowColor = `hsl(${sHue},100%,65%)`; ctx.shadowBlur = 20 + v * 40;
          ctx.lineWidth = 2 + v * 5; ctx.stroke();
        }

        // Lissajous (only every 2 frames)
        if (frame % 2 === 0) {
          analyser.getByteTimeDomainData(tdata);
          ctx.beginPath();
          for (let i = 0; i < bufLen; i += 2) { // stride 2 for perf
            const t1 = tdata[i] / 128.0 - 1;
            const t2 = tdata[(i + 50) % bufLen] / 128.0 - 1;
            const x = cx + t1 * minD * 0.3 * (1 + bp * 0.5);
            const y = cy + t2 * minD * 0.3 * (1 + bp * 0.5);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `hsla(${H2},100%,70%,${0.35 + bp * 0.3})`;
          ctx.shadowColor = `hsl(${H2},100%,70%)`; ctx.shadowBlur = 22;
          ctx.lineWidth = 1.5; ctx.stroke();
        }

        // Central orb
        const orbR = 25 + bp * 85;
        const og = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR);
        og.addColorStop(0, `hsla(${H1},100%,90%,0.95)`);
        og.addColorStop(0.4, `hsla(${H0},100%,65%,0.6)`);
        og.addColorStop(1, `hsla(${H3},100%,30%,0)`);
        ctx.shadowBlur = 65 + bp * 85; ctx.shadowColor = `hsl(${H1},100%,80%)`;
        ctx.fillStyle = og;
        ctx.beginPath(); ctx.arc(cx, cy, orbR, 0, Math.PI * 2); ctx.fill();

        // Glitter on strong beats only
        if (bass > 155) {
          const count = Math.floor(bp * 12) + 1;
          ctx.shadowBlur = 0;
          for (let i = 0; i < count; i++) {
            const gHue = dynHue(BH + Math.random() * 360);
            ctx.fillStyle = `hsla(${gHue},100%,80%,${Math.random() * 0.8 + 0.2})`;
            ctx.beginPath();
            ctx.arc(Math.random() * w, Math.random() * h, Math.random() * 3 + 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.shadowBlur = 0;
      } else if (mode === "arc3d") {
        const numCylinders = 64;
        const radius = Math.min(w, h) * 0.35;
        const maxH = h * 0.4;
        const cylinderW = (radius * Math.PI * 2) / numCylinders * 0.8;
        const step = Math.floor(bufLen / numCylinders);
        
        // Constant slow rotation (approx 12 grados por segundo)
        arc3dRotationRef.current += (Math.PI / 180) * 0.2;

        // We will store rendered cylinders to sort by depth (z-index)
        const cylindersToDraw = [];

        for (let i = 0; i < numCylinders; i++) {
          const v = fdata[i * step] / 255;
          const targetHeight = 10 + v * maxH; // 10 is base height (flat disk)

          // Lerp height for smooth transition
          const currentHeight = arc3dHeightsRef.current[i] || 10;
          const lerpFactor = targetHeight > currentHeight ? 0.15 : 0.08;
          const newHeight = currentHeight + (targetHeight - currentHeight) * lerpFactor;
          arc3dHeightsRef.current[i] = newHeight;

          // Angle for full circular arc
          const angle = (i / numCylinders) * Math.PI * 2 + arc3dRotationRef.current;

          // 3D coordinates in flat plane
          const x3d = Math.cos(angle) * radius;
          const z3d = Math.sin(angle) * radius;

          // Isometric projection
          const cos30 = 0.866; // Math.cos(30 * Math.PI / 180)
          const sin30 = 0.5;   // Math.sin(30 * Math.PI / 180)
          
          const screenX = cx + (x3d - z3d) * cos30;
          // y goes up, but canvas y goes down, so we subtract newHeight for the top of the cylinder
          const baseScreenY = cy + (x3d + z3d) * sin30 + radius * 0.5; // shift down slightly
          const topScreenY = baseScreenY - newHeight;

          cylindersToDraw.push({
            i,
            v,
            screenX,
            baseScreenY,
            topScreenY,
            height: newHeight,
            depth: x3d + z3d // For isometric depth sorting
          });
        }

        // Sort by depth (back to front)
        cylindersToDraw.sort((a, b) => a.depth - b.depth);

        // Draw everything back to front
        for (const cyl of cylindersToDraw) {
          // 1. Draw floor reflection (water effect)
          const reflectionHeight = cyl.height * 0.85; // Reflection is slightly shorter than actual height
          const reflectionBottomY = cyl.baseScreenY + reflectionHeight;
          
          if (reflectionHeight > 1) {
            ctx.beginPath();
            ctx.moveTo(cyl.screenX, cyl.baseScreenY);
            ctx.lineTo(cyl.screenX, reflectionBottomY);
            
            // Linear gradient for the reflection fading out downwards
            const refGrad = ctx.createLinearGradient(0, cyl.baseScreenY, 0, reflectionBottomY);
            const startOpacity = Math.min(1, cyl.height / maxH) * 0.6 + 0.15; 
            refGrad.addColorStop(0, `rgba(0, 255, 255, ${startOpacity})`);
            refGrad.addColorStop(1, "rgba(0, 255, 255, 0)");
            
            ctx.strokeStyle = refGrad;
            ctx.lineWidth = cylinderW;
            ctx.lineCap = "round";
            ctx.shadowBlur = 0; // No shadow for reflection
            ctx.stroke();

            // Water ripples / bright base ellipse for realism
            ctx.beginPath();
            ctx.ellipse(cyl.screenX, cyl.baseScreenY, cylinderW * 0.9, cylinderW * 0.4, 0, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0, 255, 255, ${startOpacity * 0.6})`;
            ctx.fill();
          }

          // 2. Draw cylinder body
          ctx.beginPath();
          ctx.moveTo(cyl.screenX, cyl.baseScreenY);
          ctx.lineTo(cyl.screenX, cyl.topScreenY);
          
          // Glow effect (stronger for taller cylinders)
          const glowIntensity = Math.min(1, cyl.height / maxH);
          ctx.shadowBlur = 20 + glowIntensity * 20;
          ctx.shadowColor = "#0088FF";
          
          ctx.strokeStyle = "#00FFFF";
          ctx.lineWidth = cylinderW;
          ctx.lineCap = "round";
          ctx.stroke();

          // 3. Optional: bright cap at the top
          ctx.beginPath();
          ctx.arc(cyl.screenX, cyl.topScreenY, cylinderW / 2 * 0.8, 0, Math.PI * 2);
          ctx.fillStyle = "#FFFFFF";
          ctx.shadowBlur = 10;
          ctx.shadowColor = "#00FFFF";
          ctx.fill();
        }
        
        ctx.shadowBlur = 0;
      } else if (mode === "fractal") {
        const bp = bass / 255;
        const mp = mid / 255;
        const tp = treble / 255;
        const minD = Math.min(w, h);
        
        ctx.save();
        ctx.translate(cx, cy);
        
        // --- RANDOMIZED MULTI-FRACTAL SYSTEM ---
        const cycleLength = 12; // 12 seconds per fractal shape (updated from 5)
        const totalFractals = 9;
        
        // Use time and a random offset to compute pseudo-random transitions
        const currentCycleId = Math.floor(time / cycleLength) + randomOffsetRef.current;
        const nextCycleId = currentCycleId + 1;
        const progress = (time % cycleLength) / cycleLength; // 0.0 to 1.0
        
        // Simple hash function for pseudo-random deterministic sequence
        const hash = (n: number) => {
             const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
             return x - Math.floor(x);
        };
        
        // Pick the current and next fractal randomly from the allowed list
        const allowed = allowedFractalsRef.current;
        let currentFractal = allowed[Math.floor(hash(currentCycleId) * allowed.length)];
        let nextFractal = allowed[Math.floor(hash(nextCycleId) * allowed.length)];
        
        // Crossfade logic: fade during the last 20% of the cycle
        let alphaCurrent = 1;
        let alphaNext = 0;

        if (fractalOverride !== undefined && fractalOverride !== null) {
          currentFractal = fractalOverride % totalFractals;
          alphaCurrent = 1;
          alphaNext = 0;
        } else {
          if (progress > 0.8) {
               const crossfade = (progress - 0.8) / 0.2; // 0.0 to 1.0
               alphaCurrent = 1 - crossfade;
               alphaNext = crossfade;
          }
        }

        // Report the current auto fractal to the UI
        if ((fractalOverride === undefined || fractalOverride === null) && lastReportedFractalRef.current !== currentFractal) {
          lastReportedFractalRef.current = currentFractal;
          if (onFractalChangeRef.current) {
             onFractalChangeRef.current(currentFractal);
          }
        }

        // Array of 6 fractal rendering algorithms
        type FractalRenderer = (alpha: number) => void;
        const renderers: FractalRenderer[] = [
          // 1. Recursive Fractal Trees (Optimized)
          (alpha) => {
            ctx.globalAlpha = alpha;
            
            // Organic evolutions inspired by Fractal 9
            const globalBreath = Math.cos(time * 0.035) * 0.35; // Global scaling over time
            const morphShape = Math.sin(time * 0.07) * 0.9; // Alters the branching structure heavily
            const torsion = Math.sin(time * 0.05) * 1.5; // Spiral twisting

            const roots = 6; // Reduced petal density for a cleaner look
            const maxDepth = 7; 
            
            // angleSpread evolves slowly with morphShape, making it completely change silhouette
            const angleSpread = 0.55 + mp * 0.6 + morphShape * 0.4 + Math.sin(time * 1.0) * 0.2; 
            const lengthShrink = 0.7 + tp * 0.2 + globalBreath * 0.1; // branches grow and shrink
            
            const paths = Array.from({ length: maxDepth + 1 }, () => new Path2D());
            
            const drawBranch = (x: number, y: number, len: number, angle: number, depth: number) => {
              if (depth > maxDepth) return;
              
              // Apply majestic spiral torsion (twists more at higher depths)
              const twistedAngle = angle + torsion * (depth / maxDepth);
              
              const ex = x + Math.cos(twistedAngle) * len;
              const ey = y + Math.sin(twistedAngle) * len;
              
              paths[depth].moveTo(x, y);
              
              // Organic curves instead of straight rigid lines!
              // The control point sweeps out to the side depending on torsion and time
              const cpAngle = twistedAngle + morphShape * 1.5;
              const cpLen = len * (0.4 + Math.abs(morphShape) * 0.6);
              const cpx = x + Math.cos(cpAngle) * cpLen;
              const cpy = y + Math.sin(cpAngle) * cpLen;
              
              paths[depth].quadraticCurveTo(cpx, cpy, ex, ey);
              
              const spread = angleSpread + (depth % 2 === 0 ? bp * 0.1 : -bp * 0.1);
              drawBranch(ex, ey, len * lengthShrink, twistedAngle - spread, depth + 1);
              drawBranch(ex, ey, len * lengthShrink, twistedAngle + spread, depth + 1);
            };
            
            const startLen = minD * 0.18 * (1 + globalBreath) * (1 + bp * 0.4 + Math.sin(time) * 0.05);
            const rot = time * 0.25 + bp * 0.25; // Slower rotation
            for (let i = 0; i < roots; i++) {
               drawBranch(0, 0, startLen, rot + (i * Math.PI * 2) / roots, 0);
            }
            
            for (let d = 0; d <= maxDepth; d++) {
              const depthHue = dynHue(BH + d * 35 - time * 40);
              ctx.strokeStyle = `hsla(${depthHue}, 100%, ${60 + tp * 30}%, ${1 - d/maxDepth + bp * 0.3})`;
              ctx.lineWidth = Math.max(0.5, (maxDepth - d) * 0.8 * (1 + bp * 0.5));
              if (d === maxDepth) {
                 ctx.shadowBlur = 15 + bp * 20;
                 ctx.shadowColor = `hsl(${depthHue}, 75%, 70%)`;
              } else ctx.shadowBlur = 0;
              ctx.stroke(paths[d]);
            }
            ctx.shadowBlur = 0;
          },

          // 2. Koch Star / Sierpinski Polygons with Audio-Reactive Core & Outer Ring
          (alpha) => {
            ctx.globalAlpha = alpha;
            const maxDepth = 4;
            const paths = Array.from({ length: maxDepth + 1 }, () => new Path2D());
            
            // Collect vertices for rendering glowing nodes on high treble
            const vertices: {x: number, y: number, d: number}[] = [];
            
            const drawPoly = (x: number, y: number, r: number, angle: number, depth: number) => {
               if (depth > maxDepth) return;
               for (let i = 0; i < 3; i++) {
                  const a = angle + (i * Math.PI * 2) / 3;
                  const px = x + Math.cos(a) * r;
                  const py = y + Math.sin(a) * r;
                  if (i === 0) paths[depth].moveTo(px, py);
                  else paths[depth].lineTo(px, py);
                  
                  if (depth >= 3 && tp > 0.2) {
                     vertices.push({x: px, y: py, d: depth});
                  }
               }
               paths[depth].closePath();
               
               // Shrink reacts to treble, rotation to mids
               const shrink = 0.5 + tp * 0.15;
               const rotOffset = time * 0.5 * (depth % 2 === 0 ? 1 : -1) + mp * 0.8;
               for (let i = 0; i < 3; i++) {
                  const a = angle + (i * Math.PI * 2) / 3;
                  const px = x + Math.cos(a) * r;
                  const py = y + Math.sin(a) * r;
                  drawPoly(px, py, r * shrink, angle + rotOffset, depth + 1);
               }
            };
            
            const baseR = minD * 0.32 * (1 + bp * 0.3 + Math.sin(time * 0.5) * 0.03);
            
            // Outer reactive aura/ring pulsing with bass
            if (bp > 0.3) {
               ctx.beginPath();
               ctx.arc(0, 0, baseR * 1.5 * (1 + bp * 0.2), 0, Math.PI * 2);
               ctx.strokeStyle = `hsla(${dynHue(H2)}, 100%, 60%, ${bp * 0.4})`;
               ctx.lineWidth = 2 + bp * 5;
               ctx.shadowBlur = 20 * bp;
               ctx.shadowColor = `hsl(${dynHue(H2)}, 100%, 60%)`;
               ctx.stroke();
               ctx.shadowBlur = 0;
            }

            drawPoly(0, 0, baseR, time * 0.3 + bp * 0.5, 0); 
            drawPoly(0, 0, baseR, time * -0.25 + Math.PI + mp * 0.5, 0); 
            
            // Draw the main fractal paths
            for (let d = 0; d <= maxDepth; d++) {
               const depthHue = dynHue(H1 + d * 40 + time * 15);
               ctx.strokeStyle = `hsla(${depthHue}, 75%, ${60 + tp * 30}%, ${1 - d/maxDepth + bp * 0.3})`;
               ctx.lineWidth = 1 + (maxDepth - d) * 0.6 * (1 + bp);
               
               // Add glow for outer shapes when mids/treble are high
               if (d <= 1 && mp > 0.4) {
                   ctx.shadowBlur = 10 + mp * 15;
                   ctx.shadowColor = `hsl(${depthHue}, 100%, 70%)`;
               } else {
                   ctx.shadowBlur = 0;
               }
               ctx.stroke(paths[d]);
            }
            ctx.shadowBlur = 0;

            // Draw audio-reactive nodes on vertices for high treble
            if (tp > 0.2) {
               ctx.beginPath();
               for (let i = 0; i < vertices.length; i++) {
                  const v = vertices[i];
                  // Stagger nodes based on time to create a shimmering effect without random flickering
                  if ((i + Math.floor(time * 15)) % 3 !== 0) {
                      ctx.moveTo(v.x, v.y);
                      ctx.arc(v.x, v.y, 1.5 + tp * 2.5, 0, Math.PI * 2);
                  }
               }
               ctx.fillStyle = `hsla(${dynHue(H3 + time * 50)}, 100%, 80%, ${tp * 0.8})`;
               ctx.shadowBlur = 10 + tp * 15;
               ctx.shadowColor = `hsl(${dynHue(H3)}, 100%, 75%)`;
               ctx.fill();
               ctx.shadowBlur = 0;
            }

            // Central energy core reacting to all frequencies
            const coreR = minD * 0.05 * (1 + bp * 1.5 + mp * 0.5 + tp * 0.5);
            ctx.beginPath();
            
            // Draw a reactive polygon in the center
            const coreSides = 3 + Math.floor(mp * 4); // 3 to 6 sides based on mids
            for (let i = 0; i < coreSides; i++) {
                const a = time * 2 + (i * Math.PI * 2) / coreSides;
                const px = Math.cos(a) * coreR;
                const py = Math.sin(a) * coreR;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            
            ctx.fillStyle = `hsla(${dynHue(H0 - time * 20)}, 100%, 70%, ${0.5 + bp * 0.5})`;
            ctx.fill();
            ctx.strokeStyle = `hsla(${dynHue(H0)}, 100%, 90%, ${0.8 + tp * 0.2})`;
            ctx.lineWidth = 1.5 + tp * 2;
            ctx.stroke();
          },

          // 3. Sacred Geometry Mandala
          (alpha) => {
            ctx.globalAlpha = alpha;
            const maxDepth = 3;
            const petals = 6;
            const paths = Array.from({ length: maxDepth + 1 }, () => new Path2D());
            
            const drawFlower = (x: number, y: number, r: number, angle: number, depth: number) => {
               if (depth > maxDepth) return;
               paths[depth].moveTo(x + r, y);
               paths[depth].arc(x, y, r, 0, Math.PI * 2);
               const shrink = 0.45 + tp * 0.15;
               const rotOffset = time * 0.3 + bp;
               for (let i = 0; i < petals; i++) {
                   const a = angle + (i * Math.PI * 2) / petals;
                   const dist = r * (1.2 + mp * 0.4); // expand outer radius
                   drawFlower(x + Math.cos(a) * dist, y + Math.sin(a) * dist, r * shrink, angle + rotOffset, depth + 1);
               }
            };
            // Softer expansion/rotation
            const baseR = minD * 0.25 * (1 + bp * 0.6 + Math.sin(time)*0.05);
            drawFlower(0, 0, baseR, time * 0.3 + mp * 0.3, 0);
            
            for (let d = 0; d <= maxDepth; d++) {
               const depthHue = dynHue(H3 - d * 30 - time * 30);
               ctx.strokeStyle = `hsla(${depthHue}, 100%, ${65 + tp * 20}%, ${0.8 - d/maxDepth * 0.5 + bp * 0.4})`;
               ctx.lineWidth = 1 + (maxDepth - d) * 0.6;
               ctx.stroke(paths[d]);
            }
          },

          // 4. 3D Isometric Recursive Cubes (Hypercube Fractal)
          (alpha) => {
             ctx.globalAlpha = alpha;
             const maxD = 3; 
             
             // Organic macro evolutions (Dramatically accelerated and amplified for obvious aspect changing)
             const globalBreath = Math.cos(time * 0.4) * 0.6; // Breathing scale faster and deeper
             const morphTorsion = Math.sin(time * 0.6) * 1.8; // Spatial warping much faster and wilder
             const morphSpread = Math.cos(time * 0.5) * 1.5; // Changes the explosion angle drastically
             
             const rx = time * 0.5 + bp * 0.3 + morphTorsion; 
             const ry = time * 0.35 + mp * 0.4 - morphTorsion;
             
             // 3D to 2D projection with organic spatial warping
             const project = (x: number, y: number, z: number, depth: number) => {
                 // Organic twist in 3D space! The cubes bend like gelatin based on time
                 const twist = Math.sin(time * 0.15 + (x + y) * 0.005) * morphTorsion * 80 * (depth + 1);
                 x += twist;
                 y -= twist;
                 
                 let x1 = x * Math.cos(ry) - z * Math.sin(ry);
                 let z1 = x * Math.sin(ry) + z * Math.cos(ry);
                 let y2 = y * Math.cos(rx) - z1 * Math.sin(rx);
                 let z2 = y * Math.sin(rx) + z1 * Math.cos(rx);
                 const scale = 400 / (400 + z2);
                 return [x1 * scale, y2 * scale];
             };
             
             const drawBox = (cx: number, cy: number, cz: number, s: number, depth: number) => {
                if (depth > maxD) return;
                const pts = [
                   [-1,-1,-1], [1,-1,-1], [1,1,-1], [-1,1,-1],
                   [-1,-1,1], [1,-1,1], [1,1,1], [-1,1,1]
                ].map(p => project(cx + p[0]*s, cy + p[1]*s, cz + p[2]*s, depth));
                
                ctx.beginPath();
                // Organic bending curves instead of straight rigid lines!
                [[0,1],[1,2],[2,3],[3,0], [4,5],[5,6],[6,7],[7,4], [0,4],[1,5],[2,6],[3,7]].forEach(e => {
                   const p1 = pts[e[0]];
                   const p2 = pts[e[1]];
                   ctx.moveTo(p1[0], p1[1]);
                   // Curve bends dynamically using morphTorsion
                   const bendX = (p2[1] - p1[1]) * morphTorsion * 0.4;
                   const bendY = -(p2[0] - p1[0]) * morphTorsion * 0.4;
                   ctx.quadraticCurveTo(
                       (p1[0] + p2[0]) / 2 + bendX, 
                       (p1[1] + p2[1]) / 2 + bendY, 
                       p2[0], p2[1]
                   );
                });
                
                const hue = dynHue(BH + depth * 45 + time * 10);
                ctx.strokeStyle = `hsla(${hue}, 100%, ${60 + tp*30}%, ${alpha * (1 - depth/maxD + bp*0.5)})`;
                ctx.lineWidth = 1.5 + bp*2 + (maxD - depth) * 0.5;
                ctx.stroke();
                
                // Recurse with evolving explosion distances and morphing corner targets
                if (depth < maxD) {
                    const ns = s * (0.45 + tp * 0.1 + globalBreath * 0.15); // Children cubes breathe
                    const dist = s * (1.5 + bp * 0.4 + Math.abs(morphSpread) * 0.5); // Explosion breathes
                    
                    // The corners that spawn children mutate organically over time
                    const spawnCorners = [
                       [-1 + morphSpread * 0.5, -1, -1], 
                       [1, 1 - morphSpread * 0.5, -1], 
                       [-1, 1, 1 + morphSpread * 0.5]
                    ];
                    spawnCorners.forEach(p => {
                       drawBox(cx + p[0]*dist, cy + p[1]*dist, cz + p[2]*dist, ns, depth+1);
                    });
                }
             };
             // Large initial box
             drawBox(0, 0, 0, minD * 0.4 * (1 + globalBreath) * (1 + bp * 0.3), 0);
          },

          // 5. Water Molecules (Organic Metaball/Network)
          (alpha) => {
             ctx.globalAlpha = alpha;
             const maxD = 4;
             const paths = Array.from({ length: maxD + 1 }, () => new Path2D());
             
             const drawMolecule = (x: number, y: number, r: number, angle: number, depth: number) => {
                if (depth > maxD) return;
                paths[depth].moveTo(x+r, y);
                paths[depth].arc(x, y, r, 0, Math.PI*2);
                
                const branches = depth === 0 ? 4 : 2; // More spread at root
                const rot = time * 0.2 + Math.sin(time + depth)*0.5;
                // Giant distances to cross the screen
                const dist = r * (3.5 + bp * 2.5 + Math.sin(time*2 + depth)*0.5);
                
                for(let i=0; i<branches; i++) {
                   const a = angle + rot + (i * Math.PI * 2)/branches;
                   const ex = x + Math.cos(a) * dist;
                   const ey = y + Math.sin(a) * dist;
                   
                   ctx.beginPath();
                   ctx.moveTo(x, y);
                   ctx.quadraticCurveTo(x + Math.cos(a+1)*dist*0.5, y + Math.sin(a+1)*dist*0.5, ex, ey);
                   ctx.strokeStyle = `hsla(${dynHue(H2 + depth*30)}, 75%, 65%, ${alpha * (0.3 + bp*0.3)})`;
                   ctx.lineWidth = r * 0.3;
                   ctx.stroke();
                   
                   drawMolecule(ex, ey, r * (0.7 + mp * 0.15), a, depth + 1);
                }
             };
             
              // Spread roots and make them move at moderate speed
              const numRoots = 3;
              for (let i=0; i<numRoots; i++) {
                  const rx = Math.cos(time*0.25 + i*2) * w * 0.45;
                  const ry = Math.sin(time*0.3 + i*2) * h * 0.45;
                  drawMolecule(rx, ry, minD * 0.1, time * 0.2 + i, 0);
              }
             
             for(let d=0; d<=maxD; d++) {
                 ctx.fillStyle = `hsla(${dynHue(200 + d*25 + time*45)}, 75%, 75%, ${alpha})`;
                 ctx.shadowBlur = 10 + bp*20;
                 ctx.shadowColor = "#00FFFF";
                 ctx.fill(paths[d]);
             }
             ctx.shadowBlur = 0;
          },

          // 6. Volumetric Smoke Fractal (Lissajous Noise Wisps)
          (alpha) => {
             ctx.globalAlpha = alpha * (0.15 + bp * 0.2); 
             ctx.globalCompositeOperation = "lighter"; 
             
             const wisps = 8;
             const maxD = 3;
             
             const drawWisp = (x: number, y: number, scale: number, angle: number, depth: number) => {
                if(depth > maxD) return;
                
                ctx.beginPath();
                ctx.moveTo(x, y);
                // Expand wildly
                const cx1 = x + Math.cos(angle + time) * scale * 3;
                const cy1 = y + Math.sin(angle + time*1.2) * scale * 3;
                const cx2 = x + Math.cos(angle - time*0.8) * scale * 5;
                const cy2 = y + Math.sin(angle - time*1.1) * scale * 5;
                const ex = x + Math.cos(angle) * scale * 7;
                const ey = y + Math.sin(angle) * scale * 7;
                
                ctx.bezierCurveTo(cx1, cy1, cx2, cy2, ex, ey);
                
                const hue = dynHue(BH + depth*50 + angle*20);
                ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${bp * 0.4 + 0.15})`;
                ctx.lineWidth = scale * 0.5;
                ctx.stroke();
                
                drawWisp(ex, ey, scale * 0.6, angle + Math.sin(time + depth)*1.2, depth+1);
                drawWisp(ex, ey, scale * 0.6, angle - Math.cos(time + depth)*1.2, depth+1);
             };
             
             for(let i=0; i<wisps; i++) {
                 // Spread smoke emitters over the full space
                 const sx = Math.sin(time*0.2 + i*1.3) * w * 0.6;
                 const sy = Math.cos(time*0.15 + i*1.7) * h * 0.6;
                 const a = (i * Math.PI * 2)/wisps + time * 0.15;
                 for(let j=0; j<3; j++) {
                    drawWisp(sx, sy, minD * 0.15 * (1 + j*0.1 + bp*0.3), a + j*0.2, 0);
                 }
             }
             ctx.globalCompositeOperation = "source-over"; 
          },

          // 7. Electric Sheep / Starbursts (Scattered glowing nodes with wavy radiating arms)
          (alpha) => {
             ctx.globalAlpha = alpha;
             ctx.globalCompositeOperation = "lighter"; 
             
             const numNodes = 10;
             
              for (let n = 0; n < numNodes; n++) {
                  const nx = Math.sin(time * 0.15 + n * 4.3) * w * 0.8;
                  const ny = Math.cos(time * 0.2 + n * 3.7) * h * 0.8;
                 
                 const nodeEnergy = (n % 2 === 0) ? bp : tp;
                 // Massive scales for the arms to span the entire screen
                 const scale = minD * 0.25 * (1 + nodeEnergy * 0.8);
                 
                 const arms = 8 + Math.floor(bp * 6); 
                 const nodeHue = dynHue(BH + n * 60 + time * 20);
                 
                 ctx.beginPath();
                 ctx.arc(nx, ny, scale * 0.05, 0, Math.PI * 2);
                 ctx.fillStyle = `hsla(${nodeHue}, 75%, 80%, ${0.8 * alpha})`;
                 ctx.shadowBlur = 30 + bp * 40;
                 ctx.shadowColor = `hsl(${nodeHue}, 75%, 60%)`;
                 ctx.fill();
                 
                 ctx.shadowBlur = 0; 
                 for (let a = 0; a < arms; a++) {
                     const angle = (a * Math.PI * 2) / arms + time * 0.3 * (n % 2 === 0 ? 1 : -1);
                     
                     ctx.beginPath();
                     ctx.moveTo(nx, ny);
                     
                     const cp1x = nx + Math.cos(angle - 0.8) * scale * 0.4;
                     const cp1y = ny + Math.sin(angle - 0.8) * scale * 0.4;
                     
                     const cp2x = nx + Math.cos(angle + 0.8 + Math.sin(time + a)*0.8) * scale * 0.8;
                     const cp2y = ny + Math.sin(angle + 0.8 + Math.cos(time + a)*0.8) * scale * 0.8;
                     
                     const ex = nx + Math.cos(angle + Math.sin(time * 2 + n)*0.5) * scale * 1.5;
                     const ey = ny + Math.sin(angle + Math.cos(time * 2 + n)*0.5) * scale * 1.5;
                     
                     ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey);
                     
                     ctx.strokeStyle = `hsla(${nodeHue}, 75%, 70%, ${0.5 * alpha})`;
                     ctx.lineWidth = 2 + nodeEnergy * 3;
                     ctx.stroke();
                     
                     const smallArms = 2;
                     for(let sa=0; sa<smallArms; sa++) {
                        const sAngle = angle + (sa - 0.5) * 0.8 + Math.sin(time*3)*0.3;
                        const sex = ex + Math.cos(sAngle) * scale * 0.6;
                        const sey = ey + Math.sin(sAngle) * scale * 0.6;
                        ctx.beginPath();
                        ctx.moveTo(ex, ey);
                        ctx.quadraticCurveTo(
                           ex + Math.cos(sAngle+0.8)*scale*0.3, 
                           ey + Math.sin(sAngle+0.8)*scale*0.3, 
                           sex, sey
                        );
                        ctx.strokeStyle = `hsla(${dynHue(nodeHue + 30)}, 75%, 60%, ${0.3 * alpha})`;
                        ctx.lineWidth = 1;
                        ctx.stroke();
                     }
                 }
             }
              ctx.globalCompositeOperation = "source-over"; 
          },

          // 15. Golden Ratio Sunflower — phyllotaxis spiral with audio pulse and enhancements
          (alpha) => {
            ctx.globalAlpha = alpha;
            const goldenAngle = Math.PI * (3 - Math.sqrt(5));
            const diag = Math.sqrt(w * w + h * h) / 2;
            const originalMaxR = minD * 0.46;
            const maxR = diag;
            const seeds = Math.min(Math.floor(300 * (diag * diag) / (originalMaxR * originalMaxR)), 1000); // Cap to 1000 for performance (removed 1000 seeds)
            const phase2 = time * 0.6;

            // 1. Cosmic Dust (Parallax Background) - Batched for performance
            ctx.globalCompositeOperation = "lighter";
            const dustCount = Math.min(Math.floor(150 * (diag * diag) / (originalMaxR * originalMaxR)), 400); // Cap to 400
            
            ctx.fillStyle = `hsla(200, 50%, 80%, ${0.2 * alpha})`;
            ctx.beginPath();
            for(let i=0; i<dustCount; i++) {
                const a = i * 2.13 + time * 0.1 * (i % 3 - 1);
                const r = Math.sqrt(i / dustCount) * diag;
                const px = Math.cos(a) * r;
                const py = Math.sin(a) * r;
                ctx.moveTo(px, py);
                ctx.arc(px, py, 1, 0, Math.PI * 2);
            }
            ctx.fill();

            // 2. Core Breathing Halo & Bass Reactor
            ctx.globalCompositeOperation = "lighter";
            const coreHue = dynHue(H3 + time * 10);
            
            // Soft background halo
            const haloR = minD * 0.05 * (1 + bp * 0.5); 
            const haloGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, haloR);
            haloGrad.addColorStop(0, `hsla(${coreHue}, 100%, 80%, ${(0.4 + bp * 0.6) * alpha})`);
            haloGrad.addColorStop(1, `hsla(${coreHue}, 100%, 50%, 0)`);
            ctx.beginPath();
            ctx.arc(0, 0, haloR, 0, Math.PI * 2);
            ctx.fillStyle = haloGrad;
            ctx.fill();

            // The jagged "Energy Core" inside that reacts aggressively to bass
            if (bp > 0.05) {
                const spikes = 16;
                ctx.beginPath();
                for (let i = 0; i <= spikes; i++) {
                    const spikeAngle = (i / spikes) * Math.PI * 2 + time * 5;
                    const noise = Math.sin(spikeAngle * 6 + time * 20) * 0.5 + 0.5;
                    const spikeR = minD * 0.015 + minD * 0.07 * bp * noise;
                    if (i === 0) ctx.moveTo(Math.cos(spikeAngle) * spikeR, Math.sin(spikeAngle) * spikeR);
                    else ctx.lineTo(Math.cos(spikeAngle) * spikeR, Math.sin(spikeAngle) * spikeR);
                }
                ctx.fillStyle = `hsla(${coreHue}, 100%, 90%, ${(0.5 + bp * 0.5) * alpha})`;
                ctx.fill();
                
                // Super hot white center dot on extreme bass drops
                ctx.beginPath();
                ctx.arc(0, 0, minD * 0.01 * (1 + bp * 3), 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 255, ${(bp) * alpha})`;
                ctx.fill();
            }
            ctx.globalCompositeOperation = "source-over"; // Reset composite for outer ring

            // 2.5 Inner Source Ring (Encierra el núcleo)
            const innerRingR = minD * 0.08 * (1 + bp * 0.1); // Tight boundary around the core
            ctx.beginPath();
            ctx.arc(0, 0, innerRingR, 0, Math.PI * 2);
            ctx.strokeStyle = `hsla(${coreHue}, 100%, 60%, ${(0.8 + bp * 0.5) * alpha})`;
            ctx.lineWidth = 2 + tp * 3;
            ctx.setLineDash([4, 4]); // Dashed ring
            ctx.stroke();
            ctx.setLineDash([]); // reset

            // 3. Orbital Outer Ring (Mids Reactive)
            const ringR = originalMaxR * (1.05 + mp * 0.2); // JUMPS WITH MIDS
            ctx.beginPath();
            ctx.arc(0, 0, ringR, 0, Math.PI * 2);
            ctx.strokeStyle = `hsla(${dynHue(H1 - time * 15)}, 80%, 50%, ${0.2 * alpha})`;
            ctx.lineWidth = 2 + mp * 10; // THICKER WITH MIDS
            ctx.setLineDash([4 + tp * 10, 8 + mp * 30]); // DASHES REACT TO TREBLE/MIDS
            ctx.stroke();
            ctx.setLineDash([]); // reset

            // 4. Circular Equalizer Bars (El Clásico)
            const eqBars = 180;
            const eqBaseR = ringR + 10 + bp * 5; // Draw just outside the orbital ring, jumps with bass
            ctx.globalCompositeOperation = "lighter";
            for (let i = 0; i < eqBars; i++) {
                // Get frequency data (spread across first half of buffer to capture mostly bass/mids)
                const freqVal = fdata[Math.floor((i / eqBars) * (bufLen * 0.4))] / 255;
                if (freqVal < 0.03) continue;
                
                const barAngle = (i / eqBars) * Math.PI * 2 - time * 0.4; // Slowly rotate backwards
                const barLen = freqVal * minD * 0.25 * (1 + bp * 0.5); // Length based on frequency power
                const x1 = Math.cos(barAngle) * eqBaseR;
                const y1 = Math.sin(barAngle) * eqBaseR;
                const x2 = Math.cos(barAngle) * (eqBaseR + barLen);
                const y2 = Math.sin(barAngle) * (eqBaseR + barLen);
                
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                
                // Color gradient loops around the circle
                const iHue = dynHue(H1 + (i / eqBars) * 360 + time * 15);
                ctx.strokeStyle = `hsla(${iHue}, 100%, 65%, ${(0.3 + freqVal * 0.7) * alpha})`;
                ctx.lineWidth = 1.5 + freqVal * 3;
                ctx.lineCap = "round";
                ctx.stroke();
            }
            ctx.lineCap = "butt"; // reset lineCap

            // Main Sunflower (with Metamorphosis and Trails)
            // Optimization: Use "lighter" instead of heavy shadowBlur for a natural glow effect
            ctx.globalCompositeOperation = "lighter";
            
            for (let i = 0; i < seeds; i++) {
              const t2 = i / seeds;
              // BASS DEEPENS THE WAVE (Reduced intensity), MIDS TIGHTEN THE WAVE FREQUENCY
              const r = Math.sqrt(t2) * maxR * (1 + bp * 0.15 * Math.sin(t2 * (10 + mp * 5) - time * 5));
              
              // Skip particles inside the inner ring to make it look like they emit FROM the ring
              if (r < innerRingR) continue;

              // BASS ADDS ROTATIONAL TWITCH. Angle based on original i maintains pattern
              const angle = i * goldenAngle + phase2 + bp * 0.1 * Math.sin(t2 * 20);
              const px = Math.cos(angle) * r;
              const py = Math.sin(angle) * r;
              
              const relR = r / originalMaxR;
              // TREBLE AND BASS MAKE PARTICLES MUCH LARGER
              const size = (2.0 + tp * 8 + bp * 3) * Math.max(0.2, 1 - relR * 0.6);
              // COLOR SHIFTS WITH MIDS
              const hue = dynHue(H3 + relR * (220 + mp * 100) + time * 20); 
              
              ctx.beginPath();
              
              // METAMORPHOSIS PUSHES INWARD WITH BASS
              if (r > originalMaxR * (0.65 - bp * 0.3)) {
                 // Spiky shapes rotate faster with treble
                 const rot = angle + time * (1 + tp * 2); 
                 ctx.moveTo(px + Math.cos(rot) * size * 1.5, py + Math.sin(rot) * size * 1.5);
                 ctx.lineTo(px + Math.cos(rot + Math.PI/2) * size * 0.5, py + Math.sin(rot + Math.PI/2) * size * 0.5);
                 
                 // Elongate the tail in the opposite direction of rotation (simulating comets/trails!)
                 const trailLengthMultiplier = r > originalMaxR * (0.8 - bp * 0.2) ? (1.5 + tp * 6.0 + bp * 2.0) : 1.5;
                 ctx.lineTo(px - Math.cos(rot) * size * trailLengthMultiplier, py - Math.sin(rot) * size * trailLengthMultiplier);
                 
                 ctx.lineTo(px + Math.cos(rot - Math.PI/2) * size * 0.5, py + Math.sin(rot - Math.PI/2) * size * 0.5);
                 ctx.closePath();
              } else {
                 // Inner seeds stay as circles
                 ctx.arc(px, py, size, 0, Math.PI * 2);
              }
              
              // OPACITY BOOSTS WITH BASS AND TREBLE
              ctx.fillStyle = `hsla(${hue}, 90%, 65%, ${(0.4 + bp * 0.4 + tp * 0.2) * alpha})`;
              ctx.fill();
            }
            ctx.globalCompositeOperation = "source-over";
          },

          // 9. 🌀 FRACTAL CORE — Kaleidoscopic mandala portal
          (alpha) => {
            const TAU = Math.PI * 2;
            const T   = time;
            const D   = minD;

            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = alpha;

            // ─── 1. Stellar Dust & Deep Breathing Nebula Background ────────
            // Cosmic Space Dust (Deterministic & high performance)
            ctx.globalCompositeOperation = "lighter";
            ctx.fillStyle = `hsla(${dynHue(BH)}, 40%, 85%, ${0.25 * alpha})`;
            ctx.beginPath();
            for (let i = 0; i < 60; i++) {
              const seedX = Math.sin(i * 43.19 + 7.4) * 0.5 + 0.5;
              const seedY = Math.cos(i * 19.32 + 3.9) * 0.5 + 0.5;
              const speed = 0.05 + 0.1 * (i % 5);
              const starAng = time * speed + i * 2.3;
              const starR = D * 0.03 + D * 0.45 * Math.sqrt(seedX);
              const sx = Math.cos(starAng) * starR;
              const sy = Math.sin(starAng) * starR;
              const size = (0.8 + (i % 3) * 0.6) * (1 + tp * 0.8);
              ctx.moveTo(sx, sy);
              ctx.arc(sx, sy, size, 0, TAU);
            }
            ctx.fill();

            // Upgraded Cosmic Nebula Clouds (Organic breathing gas)
            for (let n = 0; n < 5; n++) {
              const nAng = (n / 5) * TAU + T * 0.03 + n * 1.5;
              // Expand/contract based on sub-bass bp
              const nR   = D * (0.20 + 0.18 * Math.sin(T * 0.05 + n * 2.0) + bp * 0.1);
              const nx   = Math.cos(nAng) * nR;
              const ny   = Math.sin(nAng) * nR;
              const nHue = dynHue(BH + n * 45 - T * 5);
              const cloudSize = D * (0.35 + bp * 0.15 + Math.sin(T * 0.1 + n) * 0.05);
              const ng   = ctx.createRadialGradient(nx, ny, 0, nx, ny, cloudSize);
              ng.addColorStop(0,   `hsla(${nHue}, 85%, 10%, ${0.35 * alpha})`);
              ng.addColorStop(0.5, `hsla(${nHue}, 75%, 5%,  ${0.18 * alpha})`);
              ng.addColorStop(1,   `hsla(${nHue}, 65%, 2%,  0)`);
              ctx.fillStyle = ng;
              ctx.beginPath();
              ctx.arc(nx, ny, cloudSize, 0, TAU);
              ctx.fill();
            }

            // ─── 2. MANDALA BEZIER PETAL LAYERS ────────────────────────────
            // [spokes, innerFrac, outerFrac, rotDir, hueBase, fillOpacity]
            const spikeLayers: [number,number,number,number,number,number][] = [
              [8,  0.07, 0.20,  1,  195, 0.70],
              [12, 0.15, 0.30, -1,  215, 0.60],
              [18, 0.23, 0.40,  1,  265, 0.52],
              [24, 0.32, 0.50, -1,  305, 0.44],
              [36, 0.42, 0.58,  1,  185, 0.34],
              [48, 0.51, 0.65, -1,  200, 0.24],
              [60, 0.60, 0.72,  1,  230, 0.16],
              [72, 0.69, 0.80, -1,  260, 0.10],
            ];

            for (let li = 0; li < spikeLayers.length; li++) {
              const [spokes, iF, oF, rotDir, hBase, fillOp] = spikeLayers[li];
              // Perfectly smooth continuous rotation using monotonic mandalaRot
              const layerRot = mandalaRot * (0.24 - li * 0.026) * rotDir;

              // Smooth continuous camera traveling zoom effect (fly-through depth!)
              // As time goes on, layers move outwards (progress goes 0 -> 1)
              const travelIndex = ((li - mandalaRot * 0.05) % 8 + 8) % 8;
              const travelProgress = travelIndex / 8;
              
              // Exponential/linear expansion for natural depth perception (camera travel!)
              // + Global slow evolution: The entire flower breathes inward and outward over long periods
              const globalBreath = Math.cos(T * 0.03 + li * 0.1) * 0.35; 
              const currentScale = Math.max(0.01, (0.05 + 0.90 * travelProgress) * (1.0 + globalBreath));
              
              // Fade-in when emerging from the center, fade-out when exiting at the screen edge
              let fade = 1.0;
              if (travelProgress < 0.15) {
                fade = travelProgress / 0.15;
              } else if (travelProgress > 0.78) {
                fade = Math.max(0, (1.0 - travelProgress) / 0.22);
              }

              const iR    = D * currentScale * (1 + bp * 0.30);
              const oR    = D * currentScale * 1.5 * (1 + bp * 0.24) + D * 0.03 * mp;
              
              // Slow macro-morphing factors so the fractal shape evolves organically over time
              const morphMacro = Math.sin(T * 0.1 + li * 0.8);
              const bHalf = iR * (0.35 + morphMacro * 0.15); // Petal base width fluctuates
              const tipEx = D * 0.04 * tp * Math.abs(Math.sin(mandalaRot * 15 + li));
              const step  = TAU / spokes;

              ctx.globalCompositeOperation = "source-over";
              ctx.save();
              ctx.rotate(layerRot);

              for (let s = 0; s < spokes; s++) {
                const sHue = dynHue(hBase + s * (120 / spokes) + T * 10);
                ctx.save();
                ctx.rotate(s * step);

                // Elegant Bezier-curved lotus/flame petal shape
                // Adding organic breathing dynamism based on time (T) and petal index (s)
                const breath = Math.sin(T * 2.5 + s * 0.5 + li) * 0.15; 
                const breathW = Math.cos(T * 1.8 + s * 0.3) * 0.08;
                const tipDynamic = tipEx + Math.sin(T * 3.5 + s * 0.8) * (oR * 0.03);
                
                // Slow organic morphing of the petal's silhouette
                const morphShapeY = 1.8 + Math.cos(T * 0.15 + li * 0.5) * 0.7; // oscillates the bulbousness
                
                // TORSION EVOLUTION: Asymmetric skewing that turns petals into curved spiral arms
                const torsion = Math.sin(T * 0.07 + li * 0.4) * 1.6; // Very slow, majestic twisting
                const skew = torsion * bHalf; 

                ctx.beginPath();
                ctx.moveTo(iR, -bHalf);
                // Control points for the outer curve (bloom reacts to treble tp + dynamic breath + morph)
                const cpX = iR + (oR - iR) * (0.45 + breathW + bp * 0.05);
                const cpY1 = -bHalf * (morphShapeY + tp * 1.5 + breath) + skew;
                const cpY2 = bHalf * (morphShapeY + tp * 1.5 + breath) + skew;
                
                ctx.quadraticCurveTo(cpX, cpY1, oR + tipDynamic, skew * 1.3); // The tip shifts sideways
                ctx.quadraticCurveTo(cpX, cpY2, iR, bHalf);
                ctx.quadraticCurveTo(iR * (0.8 + breathW * 0.5), skew * 0.5, iR, -bHalf);
                ctx.closePath();

                // Multi-color linear gradient along the petal body (scaled by travel fade)
                const petalGrad = ctx.createLinearGradient(iR, 0, oR + tipEx, 0);
                petalGrad.addColorStop(0, `hsla(${dynHue(sHue)}, 100%, 45%, ${fillOp * fade * alpha})`);
                petalGrad.addColorStop(0.5, `hsla(${dynHue(sHue + 40 + mp * 40)}, 100%, 55%, ${fillOp * 0.8 * fade * alpha})`);
                petalGrad.addColorStop(1, `hsla(${dynHue(sHue + 80 + bp * 60)}, 100%, 65%, ${fillOp * 0.4 * fade * alpha})`);
                ctx.fillStyle = petalGrad;

                ctx.fill();



                ctx.restore();
              }
              ctx.restore();
            }

            // ─── 3. CYBERPUNK HUD & TECHNICAL RINGS ────────────────────────
            ctx.globalCompositeOperation = "lighter";
            ctx.save();
            
            // Technical Ring 1: Dashed Inner Dial (Clockwise rotation)
            const hudRot1 = mandalaRot * 0.2;
            ctx.save();
            ctx.rotate(hudRot1);
            ctx.beginPath();
            ctx.arc(0, 0, D * 0.11 * (1 + bp * 0.05), 0, TAU);
            ctx.strokeStyle = `hsla(${dynHue(BH + 60)}, 100%, 70%, ${0.45 * alpha})`;
            ctx.lineWidth = 1.2;
            ctx.setLineDash([6, 12, 2, 12]);
            ctx.stroke();
            ctx.restore();

            // Technical Ring 2: Compass Ticks (Counter-clockwise rotation)
            const hudRot2 = -mandalaRot * 0.15;
            ctx.save();
            ctx.rotate(hudRot2);
            const ticks = 48;
            ctx.strokeStyle = `hsla(${dynHue(BH + 140)}, 100%, 65%, ${0.35 * alpha})`;
            ctx.lineWidth = 1.0;
            const tInnerR = D * 0.26 * (1 + bp * 0.06);
            const tOuterR = tInnerR + D * 0.015 * (1 + tp * 1.5);
            ctx.beginPath();
            for (let i = 0; i < ticks; i++) {
              const a = (i / ticks) * TAU;
              const cos = Math.cos(a), sin = Math.sin(a);
              if (i % 6 === 0) {
                ctx.moveTo(cos * tInnerR, sin * tInnerR);
                ctx.lineTo(cos * (tOuterR + D * 0.01), sin * (tOuterR + D * 0.01));
              } else if (i % 2 === 0) {
                ctx.moveTo(cos * tInnerR, sin * tInnerR);
                ctx.lineTo(cos * tOuterR, sin * tOuterR);
              }
            }
            ctx.stroke();
            ctx.restore();

            // Technical Ring 3: Segmented Thick Outer Ring (Mids Reactive)
            const hudRot3 = mandalaRot * 0.1;
            ctx.save();
            ctx.rotate(hudRot3);
            ctx.beginPath();
            ctx.arc(0, 0, D * 0.37 * (1 + bp * 0.08), 0, TAU * 0.45);
            ctx.strokeStyle = `hsla(${dynHue(BH + 220)}, 100%, 72%, ${0.28 * alpha})`;
            ctx.lineWidth = 2.0;
            ctx.stroke();
            
            ctx.beginPath();
            ctx.arc(0, 0, D * 0.37 * (1 + bp * 0.08), TAU * 0.5, TAU * 0.95);
            ctx.strokeStyle = `hsla(${dynHue(BH + 220)}, 100%, 72%, ${0.28 * alpha})`;
            ctx.lineWidth = 2.0;
            ctx.stroke();
            
            ctx.font = `${Math.floor(D * 0.018)}px monospace`;
            ctx.fillStyle = `hsla(${dynHue(BH + 180)}, 100%, 75%, ${0.6 * alpha})`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const labelDist = D * 0.39 * (1 + bp * 0.08);
            ctx.fillText("N", 0, -labelDist);
            ctx.fillText("S", 0, labelDist);
            ctx.fillText("E", labelDist, 0);
            ctx.fillText("W", -labelDist, 0);
            
            ctx.restore();
            
            // Technical Ring 4: Circular Audio Oscilloscope HUD (high-performance)
            ctx.save();
            ctx.rotate(-mandalaRot * 0.08); // Rotate very slowly
            ctx.beginPath();
            const oscPoints = 120;
            const oscR = D * 0.41 * (1 + bp * 0.04);
            for (let i = 0; i <= oscPoints; i++) {
              const fract = i / oscPoints;
              // Sample time domain data (silence is 128)
              const tVal = tdata[Math.floor(fract * bufLen * 0.4)] / 128.0 - 1;
              const angle = fract * TAU;
              // Waveform displacement reactive to mids/bass
              const offset = tVal * D * 0.03 * (1 + bp * 0.5);
              const px = Math.cos(angle) * (oscR + offset);
              const py = Math.sin(angle) * (oscR + offset);
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.strokeStyle = `hsla(${dynHue(BH + 260)}, 100%, 75%, ${0.35 * alpha})`;
            ctx.lineWidth = 1.0;
            ctx.stroke();
            ctx.restore();
            
            ctx.restore();
            ctx.setLineDash([]);
            ctx.globalCompositeOperation = "source-over";

            // ─── 4. CINEMATIC VOLUMETRIC LIGHT RAYS ─────────────────────────
            ctx.globalCompositeOperation = "lighter";
            const numRays = 16;
            const rayMaxLen = D * 0.65;
            const rayRot = mandalaRot * 0.05;
            
            for (let r = 0; r < numRays; r++) {
              const rayAngle = (r / numRays) * TAU + rayRot;
              const rayLen = rayMaxLen * (0.6 + 0.4 * Math.sin(mandalaRot * 2 + r * 0.7) + bp * 0.3);
              const widthSpread = 0.05 + tp * 0.08;
              
              const x1 = Math.cos(rayAngle - widthSpread) * (D * 0.05);
              const y1 = Math.sin(rayAngle - widthSpread) * (D * 0.05);
              const x2 = Math.cos(rayAngle) * rayLen;
              const y2 = Math.sin(rayAngle) * rayLen;
              const x3 = Math.cos(rayAngle + widthSpread) * (D * 0.05);
              const y3 = Math.sin(rayAngle + widthSpread) * (D * 0.05);
              
              const rayHue = dynHue(BH - 30 + r * (360 / numRays) * 0.25 + mandalaRot * 10);
              const rayGrad = ctx.createLinearGradient(0, 0, x2, y2);
              rayGrad.addColorStop(0, `hsla(${rayHue}, 95%, 75%, ${0.18 * alpha})`);
              rayGrad.addColorStop(0.3, `hsla(${rayHue}, 90%, 65%, ${0.08 * alpha})`);
              rayGrad.addColorStop(1, `hsla(${rayHue}, 80%, 55%, 0)`);
              
              ctx.fillStyle = rayGrad;
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
              ctx.lineTo(x3, y3);
              ctx.closePath();
              ctx.fill();
            }
            ctx.globalCompositeOperation = "source-over";

            // ─── 5. CHROMATIC ABERRATION BASS SHOCKWAVES ───────────────────
            if (bp > 0.25) {
              const shR = D * 0.58 * bp;
              const shAlpha = (bp - 0.25) / 0.75 * 0.55 * alpha;
              ctx.globalCompositeOperation = "lighter";
              ctx.lineWidth = 1.5 + bp * 6;
              
              ctx.beginPath();
              ctx.arc(-2 - bp * 5, 0, shR, 0, TAU);
              ctx.strokeStyle = `rgba(255, 0, 80, ${shAlpha})`;
              ctx.stroke();
              
              ctx.beginPath();
              ctx.arc(2 + bp * 5, 0, shR, 0, TAU);
              ctx.strokeStyle = `rgba(0, 255, 255, ${shAlpha})`;
              ctx.stroke();
              
              ctx.beginPath();
              ctx.arc(0, 0, shR, 0, TAU);
              ctx.strokeStyle = `rgba(255, 255, 255, ${shAlpha * 0.6})`;
              ctx.lineWidth = 1.0;
              ctx.stroke();
              
              ctx.globalCompositeOperation = "source-over";
            }

            // ─── 6. TREBLE STARBURST FLARES ────────────────────────────────
            if (tp > 0.12) {
              ctx.globalCompositeOperation = "lighter";
              const spkN = Math.min(Math.floor(tp * 28) + 4, 22);
              for (let sp = 0; sp < spkN; sp++) {
                const sAng = (sp / spkN) * TAU + mandalaRot * 1.8 + sp * 1.618;
                const sR   = D * (0.06 + (sp % 6) / 6 * 0.52 + bp * 0.08);
                const sHue = dynHue(BH - 45 + sp * 18 + mandalaRot * 12);
                const sx = Math.cos(sAng) * sR;
                const sy = Math.sin(sAng) * sR;
                const flareSize = (4.0 + tp * 12.0) * (0.4 + 0.6 * (sp % 3) / 3);
                
                ctx.strokeStyle = `hsla(${sHue}, 100%, 88%, ${0.45 * tp * alpha})`;
                ctx.lineWidth = 1.0 + tp * 1.5;
                ctx.beginPath();
                ctx.moveTo(sx - flareSize, sy);
                ctx.lineTo(sx + flareSize, sy);
                ctx.moveTo(sx, sy - flareSize);
                ctx.lineTo(sx, sy + flareSize);
                ctx.stroke();
                
                ctx.beginPath();
                ctx.arc(sx, sy, 1.2 + tp * 2.0, 0, TAU);
                ctx.fillStyle  = `hsla(${sHue}, 100%, 95%, ${0.7 * tp * alpha})`;
                ctx.fill();
              }
              ctx.globalCompositeOperation = "source-over";
            }

            // ─── 7. SINGULARITY CORE & ACCRETION DISK ──────────────────────
            ctx.globalCompositeOperation = "source-over";
            const cR   = D * 0.065 * (1 - bp * 0.08);
            
            ctx.globalCompositeOperation = "lighter";
            const accHue = dynHue(BH - 60 + mandalaRot * 20);
            ctx.save();
            ctx.rotate(-mandalaRot * 3.0);
            const spiralTurns = 3;
            const spiralPoints = 80;
            ctx.beginPath();
            for (let i = 0; i < spiralPoints; i++) {
              const fraction = i / spiralPoints;
              const spiralAngle = fraction * spiralTurns * TAU;
              const spiralRadius = cR + fraction * cR * 2.0 * (1 + bp * 0.2);
              const sx = Math.cos(spiralAngle) * spiralRadius;
              const sy = Math.sin(spiralAngle) * spiralRadius;
              if (i === 0) ctx.moveTo(sx, sy);
              else ctx.lineTo(sx, sy);
            }
            ctx.strokeStyle = `hsla(${accHue}, 100%, 65%, ${0.6 * alpha})`;
            ctx.lineWidth = 2.0 + bp * 4.0;
            ctx.stroke();
            ctx.restore();
            
            ctx.globalCompositeOperation = "lighter";
            const rimG = ctx.createRadialGradient(0, 0, cR * 0.4, 0, 0, cR * 2.2);
            rimG.addColorStop(0,    `hsla(${dynHue(BH + 120)}, 100%, 80%, ${0.95 * alpha})`);
            rimG.addColorStop(0.3,  `hsla(${dynHue(BH + 200)}, 100%, 65%, ${0.75 * alpha})`);
            rimG.addColorStop(0.65, `hsla(${dynHue(BH + 280)}, 100%, 48%, ${0.35 * alpha})`);
            rimG.addColorStop(1,    `hsla(${dynHue(BH + 200)}, 100%, 30%, 0)`);
            ctx.beginPath();
            ctx.arc(0, 0, cR * 2.2, 0, TAU);
            ctx.fillStyle  = rimG;
            ctx.fill();
            
            // Gravitational Einstein Rings & High-energy Photon Sphere Orbits (Multiple concentric shells)
            const numSpheres = 4;
            for (let i = 0; i < numSpheres; i++) {
              ctx.save();
              const sphereR = cR * (2.6 + i * 0.8);
              const sphereSpeed = (1.8 - i * 0.3) * (i % 2 === 0 ? 1 : -1);
              ctx.rotate(mandalaRot * sphereSpeed);
              ctx.beginPath();
              ctx.arc(0, 0, sphereR, 0, TAU);
              
              const sphereHue = dynHue(BH + 300 + i * 20);
              ctx.strokeStyle = `hsla(${sphereHue}, 100%, 75%, ${(0.32 - i * 0.05) * alpha})`;
              ctx.lineWidth = 1.0;
              
              // Custom technical dash array for each shell
              const d1 = 4 + i * 2;
              const d2 = 18 + i * 6;
              const d3 = 1 + i;
              ctx.setLineDash([d1, d2, d3, d2]);
              ctx.stroke();
              ctx.restore();
            }

            // Swirling Accretion Inflow Streams (falling into the singularity)
            ctx.save();
            ctx.rotate(mandalaRot * 2.2);
            ctx.beginPath();
            const streams = 3;
            for (let s = 0; s < streams; s++) {
              const streamOff = (s / streams) * TAU;
              ctx.moveTo(0, 0);
              for (let i = 0; i < 40; i++) {
                const fraction = i / 40;
                // Spiral winds tighter into the center
                const angle = fraction * 2.5 * TAU + streamOff;
                const r = cR + fraction * D * 0.22;
                ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
              }
            }
            ctx.strokeStyle = `hsla(${dynHue(BH - 80)}, 95%, 72%, ${0.22 * alpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
            ctx.restore();
            ctx.setLineDash([]); // Reset
            
            ctx.globalCompositeOperation = "source-over";
            ctx.beginPath();
            ctx.arc(0, 0, cR, 0, TAU);
            ctx.fillStyle = "#000000";
            ctx.fill();
            
            ctx.beginPath();
            ctx.arc(0, 0, cR, 0, TAU);
            ctx.strokeStyle = `hsla(${dynHue(BH + 120)}, 100%, 90%, ${0.85 * alpha})`;
            ctx.lineWidth = 1.0 + tp * 2.0;
            ctx.stroke();

            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
          },

        ];

        // Render the active fractals with crossfade
        if (alphaCurrent > 0) renderers[currentFractal](alphaCurrent);
        if (alphaNext > 0 && currentFractal !== nextFractal) renderers[nextFractal](alphaNext);

        // Reset global settings
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";


        
        ctx.restore();
      }
    };

    heartbeat();
    return () => {
      isActive = false;
      window.removeEventListener("resize", resize);
      document.removeEventListener("fullscreenchange", onFSChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  // Single setup — props are read via refs, so no restarts needed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
};
