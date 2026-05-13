import { useEffect, useRef } from "react";

export type VisualMode = "bars" | "circle" | "wave" | "particles" | "universe" | "psycho" | "arc3d" | "fractal";

interface Props {
  analyser: AnalyserNode | null;
  mode: VisualMode;
  playing: boolean;
  fractalOverride?: number | null;
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

export const Visualizer = ({ analyser, mode, playing, fractalOverride }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>();
  const particlesRef = useRef<Particle[]>([]);
  const hueShiftRef = useRef(0);
  const lastBassRef = useRef(0);
  // ARC3D State
  const arc3dHeightsRef = useRef<number[]>(new Array(48).fill(0));
  const arc3dRotationRef = useRef(0);
  // Pre-allocated buffers — never recreated during animation
  const freqBufRef = useRef<Uint8Array | null>(null);
  const timeBufRef = useRef<Uint8Array | null>(null);
  const timeRef = useRef<number>(0);
  const randomOffsetRef = useRef<number>(Math.floor(Math.random() * 10000));

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

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      timeRef.current += 0.012;
      const time = timeRef.current;
      frame++;

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
      const fdata = freqBufRef.current!;
      const tdata = timeBufRef.current!;
      
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
        const totalFractals = 7;
        
        // Use time and a random offset to compute pseudo-random transitions
        const currentCycleId = Math.floor(time / cycleLength) + randomOffsetRef.current;
        const nextCycleId = currentCycleId + 1;
        const progress = (time % cycleLength) / cycleLength; // 0.0 to 1.0
        
        // Simple hash function for pseudo-random deterministic sequence
        const hash = (n: number) => {
             const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
             return x - Math.floor(x);
        };
        
        // Pick the current and next fractal randomly
        let currentFractal = Math.floor(hash(currentCycleId) * totalFractals);
        let nextFractal = Math.floor(hash(nextCycleId) * totalFractals);
        
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

        // Array of 6 fractal rendering algorithms
        type FractalRenderer = (alpha: number) => void;
        const renderers: FractalRenderer[] = [
          // 1. Recursive Fractal Trees (Optimized)
          (alpha) => {
            ctx.globalAlpha = alpha;
            const roots = 12; // Increased to 12 for many more petals
            const maxDepth = 7; 
            const angleSpread = 0.55 + mp * 0.6 + Math.sin(time * 1.0) * 0.2; // Softer spread
            const lengthShrink = 0.7 + tp * 0.2; // Softer branches
            const paths = Array.from({ length: maxDepth + 1 }, () => new Path2D());
            
            const drawBranch = (x: number, y: number, len: number, angle: number, depth: number) => {
              if (depth > maxDepth) return;
              const ex = x + Math.cos(angle) * len;
              const ey = y + Math.sin(angle) * len;
              paths[depth].moveTo(x, y);
              paths[depth].lineTo(ex, ey);
              const spread = angleSpread + (depth % 2 === 0 ? bp * 0.1 : -bp * 0.1);
              drawBranch(ex, ey, len * lengthShrink, angle - spread, depth + 1);
              drawBranch(ex, ey, len * lengthShrink, angle + spread, depth + 1);
            };
            
            const startLen = minD * 0.18 * (1 + bp * 0.4 + Math.sin(time) * 0.05);
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

          // 2. Koch Star / Sierpinski Polygons
          (alpha) => {
            ctx.globalAlpha = alpha;
            const maxDepth = 4;
            const paths = Array.from({ length: maxDepth + 1 }, () => new Path2D());
            
            const drawPoly = (x: number, y: number, r: number, angle: number, depth: number) => {
               if (depth > maxDepth) return;
               for (let i = 0; i < 3; i++) {
                  const a = angle + (i * Math.PI * 2) / 3;
                  const px = x + Math.cos(a) * r;
                  const py = y + Math.sin(a) * r;
                  if (i === 0) paths[depth].moveTo(px, py);
                  else paths[depth].lineTo(px, py);
               }
               paths[depth].closePath();
               const shrink = 0.5 + tp * 0.1;
               const rotOffset = time * 0.5 * (depth % 2 === 0 ? 1 : -1) + mp * 0.5;
               for (let i = 0; i < 3; i++) {
                  const a = angle + (i * Math.PI * 2) / 3;
                  const px = x + Math.cos(a) * r;
                  const py = y + Math.sin(a) * r;
                  drawPoly(px, py, r * shrink, angle + rotOffset, depth + 1);
               }
            };
            // Reduced base radius and slower pulsing
            const baseR = minD * 0.32 * (1 + bp * 0.3 + Math.sin(time * 0.5) * 0.03);
            drawPoly(0, 0, baseR, time * 0.3 + bp * 0.3, 0); // Slower
            drawPoly(0, 0, baseR, time * -0.25 + Math.PI + mp * 0.2, 0); 
            
            for (let d = 0; d <= maxDepth; d++) {
               const depthHue = dynHue(H1 + d * 40 + time * 15);
               ctx.strokeStyle = `hsla(${depthHue}, 75%, ${60 + tp * 30}%, ${1 - d/maxDepth + bp * 0.3})`;
               ctx.lineWidth = 1 + (maxDepth - d) * 0.5 * (1 + bp);
               ctx.stroke(paths[d]);
            }
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
             const rx = time * 0.5 + bp * 0.3; 
             const ry = time * 0.35 + mp * 0.4;
             
             // 3D to 2D projection
             const project = (x: number, y: number, z: number) => {
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
                ].map(p => project(cx + p[0]*s, cy + p[1]*s, cz + p[2]*s));
                
                ctx.beginPath();
                [[0,1],[1,2],[2,3],[3,0], [4,5],[5,6],[6,7],[7,4], [0,4],[1,5],[2,6],[3,7]].forEach(e => {
                   ctx.moveTo(pts[e[0]][0], pts[e[0]][1]);
                   ctx.lineTo(pts[e[1]][0], pts[e[1]][1]);
                });
                
                const hue = dynHue(BH + depth * 45);
                ctx.strokeStyle = `hsla(${hue}, 100%, ${60 + tp*30}%, ${alpha * (1 - depth/maxD + bp*0.5)})`;
                ctx.lineWidth = 1.5 + bp*2;
                ctx.stroke();
                
                // Recurse at specific outer corners (Reduced to 3 corners to lower density)
                if (depth < maxD) {
                    const ns = s * (0.45 + tp * 0.1);
                    const dist = s * (1.5 + bp * 0.4); // Explode outwards
                    [[-1,-1,-1], [1,1,-1], [-1,1,1]].forEach(p => {
                       drawBox(cx + p[0]*dist, cy + p[1]*dist, cz + p[2]*dist, ns, depth+1);
                    });
                }
             };
             // Large initial box
             drawBox(0, 0, 0, minD * 0.4 * (1 + bp * 0.3), 0);
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
          }
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

    draw();
    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("fullscreenchange", onFSChange);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [analyser, mode, playing, fractalOverride]);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
};
