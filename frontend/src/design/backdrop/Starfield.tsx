import React, { useRef, useEffect, useCallback } from 'react';

interface Star {
    x: number;
    y: number;
    z: number;
    size: number;
    brightness: number;
    elongation: number;
    angle: number;
    hue: number;
}

interface StarfieldProps {
    speed?: number;
    starCount?: number;
    active?: boolean;
}

const MAX_Z = 1000;
const SPAWN_RANGE = 800;

/**
 * STARFIELD — deep space flight, vanishing point drifts on arc turns.
 * Stars = soft ellipsoidal dots, no trails, full clear each frame.
 * Camera turns: right→straight→left→straight (10s phases).
 */
const Starfield: React.FC<StarfieldProps> = ({
    speed = 1.15,
    starCount = 1200,
    active = true,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const starsRef = useRef<Star[]>([]);
    const rafRef = useRef<number>(0);
    const timeRef = useRef<number>(0);

    const createStar = useCallback((randomZ = false): Star => ({
        x: (Math.random() - 0.5) * SPAWN_RANGE * 2,
        y: (Math.random() - 0.5) * SPAWN_RANGE * 2,
        z: randomZ ? Math.random() * MAX_Z : MAX_Z + Math.random() * 200,
        size: Math.random() * 2.5 + 0.5,
        brightness: Math.random() * 0.6 + 0.4,
        elongation: Math.random() < 0.15 ? Math.random() * 1.8 + 1.2 : 1,
        angle: Math.random() * Math.PI,
        hue: Math.random() < 0.85 ? 0 : Math.floor(Math.random() * 3) + 1,
    }), []);

    useEffect(() => {
        starsRef.current = Array.from({ length: starCount }, () => {
            const s = createStar(true);
            return s;
        });
    }, [starCount, createStar]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let prevTime = performance.now();
        let cw = 0, ch = 0;

        const resize = () => {
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            cw = rect.width; ch = rect.height;
            canvas.width = cw * dpr; canvas.height = ch * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();
        window.addEventListener('resize', resize);

        const COLORS: Record<number, [number,number,number]> = {
            0: [255, 255, 255],
            1: [255, 230, 180],
            2: [180, 200, 255],
            3: [255, 180, 170],
        };

        const draw = (now: number) => {
            if (!active) { rafRef.current = requestAnimationFrame(draw); return; }

            const dt = Math.min((now - prevTime) / 1000, 0.05);
            prevTime = now;
            timeRef.current += dt;
            const t = timeRef.current;

            // Arc turns: 10s phases — right→straight→left→straight
            const PHASE = 10;
            const omega = (2 * Math.PI) / (PHASE * 4);
            const arcRadius = 0.45;
            const vpX = cw / 2 - Math.cos(omega * t) * cw * arcRadius;
            const vpY = ch / 2 - Math.cos(omega * t + Math.PI * 0.6) * ch * arcRadius * 0.6;

            // Full clear
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, cw, ch);

            const stars = starsRef.current;
            const flySpeed = speed * 120;
            const focalLength = 300;

            for (let i = 0; i < stars.length; i++) {
                const s = stars[i];
                s.z -= dt * flySpeed;

                if (s.z <= 1) {
                    stars[i] = createStar(false);
                    continue;
                }

                const projScale = focalLength / s.z;
                const sx = vpX + s.x * projScale;
                const sy = vpY + s.y * projScale;

                if (sx < -30 || sx > cw + 30 || sy < -30 || sy > ch + 30) continue;

                const apparentSize = Math.max(0.3, s.size * projScale * 0.5);
                const clampedSize = Math.min(apparentSize, 8);
                const depthFactor = Math.min(1, (1 - s.z / MAX_Z) * 1.5);
                const alpha = s.brightness * depthFactor;

                if (alpha < 0.02) continue;

                const [r, g, b] = COLORS[s.hue] || COLORS[0];

                if (clampedSize < 1.5) {
                    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
                    ctx.beginPath();
                    ctx.arc(sx, sy, clampedSize, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    ctx.save();
                    ctx.translate(sx, sy);
                    ctx.rotate(s.angle);
                    ctx.scale(s.elongation, 1);
                    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, clampedSize);
                    grad.addColorStop(0,   `rgba(${r},${g},${b},${alpha * 0.9})`);
                    grad.addColorStop(0.3, `rgba(${r},${g},${b},${alpha * 0.5})`);
                    grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(0, 0, clampedSize, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                }
            }

            rafRef.current = requestAnimationFrame(draw);
        };

        rafRef.current = requestAnimationFrame(draw);
        return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener('resize', resize); };
    }, [active, speed, createStar]);

    return (
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1, mixBlendMode: 'screen' }} />
    );
};

export default Starfield;
