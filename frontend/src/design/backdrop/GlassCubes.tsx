import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

// --- Hit detection types ---
export interface HitResult {
    label: string;
    index: number;
}

export interface GlassCubesHandle {
    checkHit: (x: number, y: number) => HitResult | null;
}

interface HitRegion {
    label: string;
    index: number;
    z: number; // avg world Z for depth sorting
    polygon: { x: number; y: number }[]; // convex hull in screen coords
}

// --- Projection & rotation (pure, no closure deps) ---
const FOV = 15000;
const Z_OFF = 100.0;

function projectPt(x: number, y: number, z: number, cx: number, cy: number) {
    const scale = FOV / (z + Z_OFF);
    return { sx: cx + x * scale, sy: cy + y * scale, scale };
}

function rotatePt(
    px: number, py: number, pz: number,
    rx: number, ry: number, rz: number
): [number, number, number] {
    const y1 = py * Math.cos(rx) - pz * Math.sin(rx);
    const z1 = py * Math.sin(rx) + pz * Math.cos(rx);
    const x2 = px * Math.cos(ry) + z1 * Math.sin(ry);
    const z2 = -px * Math.sin(ry) + z1 * Math.cos(ry);
    const x3 = x2 * Math.cos(rz) - y1 * Math.sin(rz);
    const y3 = x2 * Math.sin(rz) + y1 * Math.cos(rz);
    return [x3, y3, z2];
}

/** Point-in-convex-polygon (winding number) */
function pointInPolygon(px: number, py: number, poly: { x: number; y: number }[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

/** Convex hull (Graham scan) for projected cube vertices */
function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
    const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length <= 1) return pts;
    const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower: { x: number; y: number }[] = [];
    for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    const upper: { x: number; y: number }[] = [];
    for (const p of pts.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    upper.pop(); lower.pop();
    return lower.concat(upper);
}

interface Cube {
    // World position
    x: number; y: number; z: number;
    // Velocity
    vx: number; vy: number; vz: number;
    // Rotation angles
    rx: number; ry: number; rz: number;
    // Rotation speed
    vrx: number; vry: number; vrz: number;
    // Base size (half-extent)
    size: number;
    // Energy blob inside
    blob: { x: number; y: number; z: number; vx: number; vy: number; vz: number };
    // Per-cube accent color
    hue: number;
    // Transparent label on side faces
    label: string;
}

interface GlassCubesProps {
    theme?: 'dark' | 'light';
    count?: number;
    active?: boolean;
    isAdmin?: boolean;
}

/**
 * GLASS CUBES — 3 translucent parallelepipeds with energy blobs inside.
 * Full 3D projection (8 vertices → 6 faces).
 * Movement: XY drift + Z scale (approach/recede) + gentle rotation.
 * Glass: semi-transparent faces with gradient sheen (liquid glass feel).
 * Energy blob: glowing orb bouncing inside each cube.
 */
const GlassCubes = forwardRef<GlassCubesHandle, GlassCubesProps>(({
    theme = 'dark',
    count = 3,
    active = true,
    isAdmin = false,
}, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const cubesRef = useRef<Cube[]>([]);
    const rafRef = useRef<number>(0);
    const timeRef = useRef<number>(0);
    const hitRegionsRef = useRef<HitRegion[]>([]);

    // Expose checkHit to parent via ref
    useImperativeHandle(ref, () => ({
        checkHit(x: number, y: number): HitResult | null {
            // hitRegions are sorted front-to-back (lowest Z first = closest)
            const regions = hitRegionsRef.current;
            for (const region of regions) {
                if (pointInPolygon(x, y, region.polygon)) {
                    return { label: region.label, index: region.index };
                }
            }
            return null;
        },
    }));

    // Initialize cubes spread across screen
    useEffect(() => {
        const actualCount = isAdmin ? 4 : count;

        const hues = theme === 'dark'
            ? [210, 270, 190, 0]      // blue, purple, cyan, red
            : [45, 35, 55, 10];       // gold, amber, warm, red-orange

        // Fixed starting positions: spread across full screen
        const startPos = [
            { x: -0.6, y: -0.85 },   // top-left
            { x:  0.5, y:  0.80 },   // bottom-right
            { x:  0.0, y:  0.05 },   // center
            { x: -0.45, y:  0.50 },  // 4th cube
        ];

        const labels = ['Action', 'Market', 'Bond', 'Admin'];

        cubesRef.current = Array.from({ length: actualCount }, (_, i) => ({
            label: labels[i % labels.length],
            x: startPos[i % startPos.length].x + (Math.random() - 0.5) * 0.15,
            y: startPos[i % startPos.length].y + (Math.random() - 0.5) * 0.15,
            z: 0.5 + Math.random() * 0.5,
            vx: (Math.random() - 0.5) * 0.0702,  // +35% от 0.052
            vy: (Math.random() - 0.5) * 0.0438,  // +35% от 0.0325
            vz: (Math.random() - 0.5) * 0.0263,  // +35% от 0.0195
            rx: Math.random() * Math.PI * 2,
            ry: Math.random() * Math.PI * 2,
            rz: Math.random() * Math.PI * 2,
            vrx: (Math.random() - 0.5) * 0.2,
            vry: (Math.random() - 0.5) * 0.25,
            vrz: (Math.random() - 0.5) * 0.1,
            size: (0.22 + Math.random() * 0.08) * 1.2,
            blob: {
                x: 0, y: 0, z: 0,
                vx: (Math.random() - 0.5) * 1.2,
                vy: (Math.random() - 0.5) * 1.2,
                vz: (Math.random() - 0.5) * 1.2,
            },
            hue: hues[i % hues.length],
        }));
    }, [count, theme, isAdmin]);

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

        // Use module-level projectPt / rotatePt
        const project = projectPt;
        const rotatePoint = rotatePt;

        const draw = (now: number) => {
            if (!active) { rafRef.current = requestAnimationFrame(draw); return; }

            const dt = Math.min((now - prevTime) / 1000, 0.05);
            prevTime = now;
            timeRef.current += dt;

            ctx.clearRect(0, 0, cw, ch);

            const cubes = cubesRef.current;
            const cx = cw / 2;
            const cy = ch / 2;

            // --- COMPUTE HIT REGIONS (before drawing) ---
            const isDarkTheme = theme === 'dark';
            const newHitRegions: HitRegion[] = cubes.map((cube, idx) => {
                const s = cube.size;
                if (isDarkTheme) {
                    // 3D cube: project all 8 vertices → convex hull
                    const verts: [number, number, number][] = [
                        [-s * 1.5, -s, -s * 0.6], [ s * 1.5, -s, -s * 0.6],
                        [ s * 1.5,  s, -s * 0.6], [-s * 1.5,  s, -s * 0.6],
                        [-s * 1.5, -s,  s * 0.6], [ s * 1.5, -s,  s * 0.6],
                        [ s * 1.5,  s,  s * 0.6], [-s * 1.5,  s,  s * 0.6],
                    ];
                    const screenPts = verts.map(([px, py, pz]) => {
                        const [rx, ry, rz] = rotatePt(px, py, pz, cube.rx, cube.ry, cube.rz);
                        const p = projectPt(cube.x + rx, cube.y + ry, cube.z + rz, cx, cy);
                        return { x: p.sx, y: p.sy };
                    });
                    return { label: cube.label, index: idx, z: cube.z, polygon: convexHull(screenPts) };
                } else {
                    // Ellipsoid: approximate with 12-pt polygon
                    const pc = projectPt(cube.x, cube.y, cube.z, cx, cy);
                    const rx = s * 1.5 * pc.scale;
                    const ry = s * 1.0 * pc.scale;
                    const N = 12;
                    const poly: { x: number; y: number }[] = [];
                    for (let i = 0; i < N; i++) {
                        const a = (i / N) * Math.PI * 2 + cube.rz;
                        poly.push({ x: pc.sx + Math.cos(a) * rx, y: pc.sy + Math.sin(a) * ry });
                    }
                    return { label: cube.label, index: idx, z: cube.z, polygon: poly };
                }
            });
            // Sort front-to-back (smallest Z = closest to camera)
            newHitRegions.sort((a, b) => a.z - b.z);
            hitRegionsRef.current = newHitRegions;

            // --- REPULSION: max 8% overlap ---
            for (let i = 0; i < cubes.length; i++) {
                for (let j = i + 1; j < cubes.length; j++) {
                    const a = cubes[i], b = cubes[j];
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const dist = Math.sqrt(dx*dx + dy*dy) || 0.001;
                    // Each cube radius ≈ size*1.5 (widest extent); min dist = 92% of sum
                    const minDist = (a.size * 1.5 + b.size * 1.5) * 0.92;
                    if (dist < minDist) {
                        const nx = dx / dist, ny = dy / dist;
                        // Soft push proportional to overlap
                        const overlap = (minDist - dist);
                        const push = overlap * 4.0 * dt;
                        a.vx -= nx * push; a.vy -= ny * push;
                        b.vx += nx * push; b.vy += ny * push;
                        // Hard correction to prevent exceeding limit
                        const corr = overlap * 0.5;
                        a.x -= nx * corr; a.y -= ny * corr;
                        b.x += nx * corr; b.y += ny * corr;
                    }
                }
            }

            // Glass colors per theme
            const glassAlpha = 0.12;
            const edgeAlpha = 0.45;

            for (let cubeIdx = 0; cubeIdx < cubes.length; cubeIdx++) {
                const cube = cubes[cubeIdx];
                const isDark = theme === 'dark';
                const moveMult = isDark ? 1.0 : 1.35;
                const rotMult  = isDark ? 1.0 : 1.90;
                
                // Move
                cube.x += cube.vx * moveMult * dt;
                cube.y += cube.vy * moveMult * dt;
                cube.z += cube.vz * moveMult * dt;

                // Bounce Z between 0.3 and 1.5 (approach/recede)
                if (cube.z > 1.5 || cube.z < 0.3) cube.vz *= -1;
                
                // Dynamic bounds constraint based on actual screen size
                const pScale = 15000 / (cube.z + 100.0);
                const boundX = (cw / 2) / pScale;
                const boundY = (ch / 2) / pScale;
                
                // Extent approximating the physical radius (half-width) of the block
                const extent = cube.size * 1.5; 
                
                // Add a margin equivalent to 8% of the block's visual size so it can overlap the screen edge by max 8% before bouncing
                const overlapMargin = (extent * 2) * 0.08;
                
                const limitX = Math.max(0, boundX - extent + overlapMargin);
                const limitY = Math.max(0, boundY - extent + overlapMargin);

                // Bounce XY
                if (cube.x > limitX) { cube.x = limitX; cube.vx *= -1; }
                else if (cube.x < -limitX) { cube.x = -limitX; cube.vx *= -1; }
                if (cube.y > limitY) { cube.y = limitY; cube.vy *= -1; }
                else if (cube.y < -limitY) { cube.y = -limitY; cube.vy *= -1; }

                // Gentle rotation
                cube.rx += cube.vrx * rotMult * dt;
                cube.ry += cube.vry * rotMult * dt;
                cube.rz += cube.vrz * rotMult * dt;

                // Soft correction: text faces (front/back) visible when ry ≈ 0 or π
                // Nudge ry away from ±π/2 (edge-on) so labels don't vanish for long
                if (isDark) {
                    const ryMod = ((cube.ry % Math.PI) + Math.PI) % Math.PI; // 0..π
                    const distFromEdge = Math.abs(ryMod - Math.PI / 2); // 0 at edge-on, π/2 at face-on
                    if (distFromEdge < 0.4) { // within ~23° of edge-on
                        const nudge = (ryMod < Math.PI / 2 ? -1 : 1) * 0.3 * dt;
                        cube.vry += nudge;
                    }
                }

                // Move energy blob (slowed down and constrained by 20% in light theme)
                const blob = cube.blob;
                const blobSpeedMult = isDark ? 1.0 : 0.65; // 35% slower in light theme
                const blobSpeed = (1 + Math.sqrt(cube.vx*cube.vx + cube.vy*cube.vy) * 18) * blobSpeedMult;
                
                blob.x += blob.vx * dt * blobSpeed;
                blob.y += blob.vy * dt * blobSpeed;
                blob.z += blob.vz * dt * blobSpeed;
                
                const blobAmp = isDark ? 0.7 : 0.56; // 20% less amplitude in light theme
                if (Math.abs(blob.x) > blobAmp) { blob.x = Math.sign(blob.x) * blobAmp; blob.vx *= -1; }
                if (Math.abs(blob.y) > blobAmp) { blob.y = Math.sign(blob.y) * blobAmp; blob.vy *= -1; }
                if (Math.abs(blob.z) > blobAmp) { blob.z = Math.sign(blob.z) * blobAmp; blob.vz *= -1; }

                const s = cube.size;
                const h = cube.hue;
                
                // --- THEME TOKENS ---
                const tGlassSat = isDark ? 70 : 95;
                const tGlassLit = isDark ? 60 : 35; // darker base in light theme
                const tGlassA   = isDark ? glassAlpha : glassAlpha * 1.8;
                
                const tSheenL1  = isDark ? 90 : 100; // Pure white peak highlight
                const tSheenL2  = isDark ? 70 : 85;
                const tSheenL3  = isDark ? 50 : 60;
                const tSheenA   = isDark ? 0.18 : 0.95; // Maximum intensity reflection
                
                const tEdgeSat  = isDark ? 80 : 100;
                const tEdgeLit  = isDark ? 85 : 40; // darker, burnt edges
                const tEdgeA    = isDark ? edgeAlpha : edgeAlpha * 1.4;
                
                const tTextSat  = isDark ? 20 : 60;
                const tTextLit  = isDark ? 95 : 20; // very dark text in light theme
                const tTextBaseA = isDark ? 0.35 : 0.75; // bolder text
                
                const tBlobHue  = isDark ? h : 25; // 25 is Orange (Fire/Flame)
                
                const tGlowL1   = isDark ? 80 : 75; // Bright ambient fire
                const tGlowL2   = isDark ? 65 : 60;
                const tGlowL3   = isDark ? 50 : 30;
                
                const tCoreL1   = isDark ? 95 : 100; // Pure hot yellow/white center
                const tCoreL2   = isDark ? 75 : 80;  // Bright yellow
                const tCoreL3   = isDark ? 55 : 60;  // Orange

                // 8 vertices of a box (aspect: wider than tall, like a card)
                if (isDark) {
                const t = timeRef.current;
                const verts: [number, number, number][] = [
                    [-s * 1.5, -s, -s * 0.6],
                    [ s * 1.5, -s, -s * 0.6],
                    [ s * 1.5,  s, -s * 0.6],
                    [-s * 1.5,  s, -s * 0.6],
                    [-s * 1.5, -s,  s * 0.6],
                    [ s * 1.5, -s,  s * 0.6],
                    [ s * 1.5,  s,  s * 0.6],
                    [-s * 1.5,  s,  s * 0.6],
                ];

                // Rotate all vertices
                const rotated = verts.map(([px, py, pz]) =>
                    rotatePoint(px, py, pz, cube.rx, cube.ry, cube.rz)
                );

                // Project to screen
                const projected = rotated.map(([px, py, pz]) =>
                    project(cube.x + px, cube.y + py, cube.z + pz, cx, cy)
                );

                // 6 faces with text mapping
                const faces: { idx: number[], textPts?: number[], logW?: number, logH?: number }[] = [
                    { idx: [0,1,2,3], textPts: [0,1,3], logW: 3000, logH: 2000 },
                    { idx: [4,5,6,7], textPts: [5,4,6], logW: 3000, logH: 2000 },
                    { idx: [0,4,7,3] },
                    { idx: [1,5,6,2] },
                    { idx: [0,1,5,4] },
                    { idx: [3,2,6,7] },
                ];

                // Compute face normals
                const faceData = faces.map(face => {
                    const [a, b, c] = face.idx;
                    const [ax, ay] = rotated[a];
                    const [bx, by] = rotated[b];
                    const [cx2, cy2] = rotated[c];
                    const nz = (bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax);
                    const dot = -nz;
                    return { ...face, dot, normalZ: nz };
                });

                // Sort faces back to front
                faceData.sort((a, b) => {
                    const avgZA = a.idx.reduce((s, i) => s + rotated[i][2], 0) / 4;
                    const avgZB = b.idx.reduce((s, i) => s + rotated[i][2], 0) / 4;
                    return avgZB - avgZA;
                });

                // --- HOLOGRAPHIC FACES ---
                for (const face of faceData) {
                    const pts = face.idx.map(i => projected[i]);
                    const brightness = Math.max(0, face.dot) * 0.5 + 0.5;
                    const hasTxt = !!(face.textPts && face.logW && face.logH);

                    // Ultra-transparent holographic face fill
                    ctx.beginPath();
                    ctx.moveTo(pts[0].sx, pts[0].sy);
                    pts.slice(1).forEach(p => ctx.lineTo(p.sx, p.sy));
                    ctx.closePath();
                    ctx.fillStyle = `hsla(${h}, ${tGlassSat}%, ${tGlassLit}%, ${tGlassA * brightness * 0.4})`;
                    ctx.fill();

                    // --- GLITCH on faces WITHOUT text (desynchronized per cube) ---
                    // Each cube has its own glitch phase offset so they don't fire simultaneously
                    const glitchSeed = cubeIdx * 7.3 + 2.1; // unique per cube
                    if (!hasTxt && Math.sin(t * 3.2 + glitchSeed + face.dot * 10) > 0.65) {
                        const glitchAlpha = 0.12 + Math.sin(t * 12 + glitchSeed + face.dot * 7) * 0.06;
                        // Random horizontal offset lines
                        ctx.save();
                        ctx.beginPath();
                        ctx.moveTo(pts[0].sx, pts[0].sy);
                        pts.slice(1).forEach(p => ctx.lineTo(p.sx, p.sy));
                        ctx.closePath();
                        ctx.clip();

                        const minY = Math.min(...pts.map(p => p.sy));
                        const maxY = Math.max(...pts.map(p => p.sy));
                        const minX = Math.min(...pts.map(p => p.sx));
                        const maxX = Math.max(...pts.map(p => p.sx));

                        // RGB split glitch bars
                        for (let gi = 0; gi < 3; gi++) {
                            const gy = minY + Math.abs(Math.sin(t * 7 + gi * 2.3 + glitchSeed + face.dot * 5)) * (maxY - minY);
                            const gh = 3 + Math.random() * 4;
                            const gShift = (Math.sin(t * 11 + gi * 3) > 0.3 ? 1 : -1) * (3 + Math.random() * 6);
                            ctx.fillStyle = `hsla(${h + gi * 120}, 90%, 70%, ${glitchAlpha})`;
                            ctx.fillRect(minX + gShift, gy, maxX - minX, gh);
                        }
                        ctx.restore();
                    }

                    // Holographic sheen
                    if (face.dot > 0.05) {
                        const p0 = pts[0], p2 = pts[2];
                        const grad = ctx.createLinearGradient(p0.sx, p0.sy, p2.sx, p2.sy);
                        grad.addColorStop(0, `hsla(${h + 40}, 90%, 85%, ${0.08 * brightness})`);
                        grad.addColorStop(0.5, `hsla(${h}, 70%, 60%, 0)`);
                        grad.addColorStop(1, `hsla(${h - 40}, 90%, 85%, ${0.05 * brightness})`);
                        ctx.fillStyle = grad;
                        ctx.beginPath();
                        ctx.moveTo(pts[0].sx, pts[0].sy);
                        pts.slice(1).forEach(p => ctx.lineTo(p.sx, p.sy));
                        ctx.closePath();
                        ctx.fill();
                    }

                    // --- HOLOGRAPHIC TEXT — brighter, with double glow ---
                    if (hasTxt) {
                        const [pTL, pTR, pBL] = face.textPts!.map((i: number) => projected[i]);
                        const lw = face.logW!;
                        const lh = face.logH!;

                        const m11 = (pTR.sx - pTL.sx) / lw;
                        const m12 = (pTR.sy - pTL.sy) / lw;
                        const m21 = (pBL.sx - pTL.sx) / lh;
                        const m22 = (pBL.sy - pTL.sy) / lh;

                        ctx.save();
                        const textAlpha = Math.min(1, tTextBaseA * 1.5 * Math.max(0.2, face.dot + 0.7));
                        ctx.transform(m11, m12, m21, m22, pTL.sx, pTL.sy);

                        // Outer glow layer
                        ctx.shadowColor = `hsla(${h}, 100%, 75%, ${textAlpha * 0.8})`;
                        ctx.shadowBlur = 20;
                        ctx.font = '800 350px Inter, system-ui, sans-serif';
                        ctx.fillStyle = `hsla(${h}, 30%, 100%, ${textAlpha * 0.9})`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(cube.label.toUpperCase(), lw / 2, lh / 2, lw * 0.85);

                        // Crisp inner text (no shadow)
                        ctx.shadowBlur = 0;
                        ctx.fillStyle = `hsla(${h}, 10%, 100%, ${textAlpha})`;
                        ctx.fillText(cube.label.toUpperCase(), lw / 2, lh / 2, lw * 0.85);
                        ctx.restore();
                    }
                }

                // --- GLOWING EDGES WITH ELECTRIC PULSE ---
                const outerEdges: [number, number][] = [
                    [0,1],[1,2],[2,3],[3,0],
                    [4,5],[5,6],[6,7],[7,4],
                    [0,4],[1,5],[2,6],[3,7],
                ];

                for (let ei = 0; ei < outerEdges.length; ei++) {
                    const [a, b] = outerEdges[ei];
                    const pa = projected[a], pb = projected[b];

                    // Base edge glow
                    ctx.beginPath();
                    ctx.moveTo(pa.sx, pa.sy);
                    ctx.lineTo(pb.sx, pb.sy);
                    ctx.strokeStyle = `hsla(${h}, ${tEdgeSat}%, ${tEdgeLit}%, ${tEdgeA * 0.7})`;
                    ctx.lineWidth = 1.0;
                    ctx.stroke();

                    // Electric pulse — bright spot traveling along each edge (slowed 40%)
                    const pulsePhase = (t * 0.48 + ei * 0.25) % 1.0;
                    const px2 = pa.sx + (pb.sx - pa.sx) * pulsePhase;
                    const py2 = pa.sy + (pb.sy - pa.sy) * pulsePhase;
                    const pulseR = 4 + Math.sin(t * 3 + ei) * 2;

                    const pulseGrad = ctx.createRadialGradient(px2, py2, 0, px2, py2, pulseR);
                    pulseGrad.addColorStop(0, `hsla(${h + 30}, 100%, 95%, 0.9)`);
                    pulseGrad.addColorStop(0.4, `hsla(${h}, 100%, 75%, 0.4)`);
                    pulseGrad.addColorStop(1, `hsla(${h}, 80%, 60%, 0)`);
                    ctx.fillStyle = pulseGrad;
                    ctx.beginPath();
                    ctx.arc(px2, py2, pulseR, 0, Math.PI * 2);
                    ctx.fill();
                }

                // --- ENERGY BLOB (holographic core) ---
                const [bx3, by3, bz3] = rotatePoint(
                    blob.x * s, blob.y * s, blob.z * s * 0.6,
                    cube.rx, cube.ry, cube.rz
                );
                const bProj = project(cube.x + bx3, cube.y + by3, cube.z + bz3, cx, cy);

                const blobR = s * 28 * bProj.scale * 0.012;
                const blobX = bProj.sx;
                const blobY = bProj.sy;

                // Holographic flicker effect
                const flicker = 0.7 + Math.sin(t * 8) * 0.15 + Math.sin(t * 13) * 0.1;

                // Outer glow
                const blobGlow = ctx.createRadialGradient(blobX, blobY, 0, blobX, blobY, blobR * 2.5);
                blobGlow.addColorStop(0, `hsla(${tBlobHue + 20}, 100%, ${tGlowL1}%, ${0.40 * flicker})`);
                blobGlow.addColorStop(0.4, `hsla(${tBlobHue}, 90%, ${tGlowL2}%, ${0.20 * flicker})`);
                blobGlow.addColorStop(1, `hsla(${tBlobHue}, 80%, ${tGlowL3}%, 0)`);
                ctx.fillStyle = blobGlow;
                ctx.beginPath();
                ctx.arc(blobX, blobY, blobR * 2.5, 0, Math.PI * 2);
                ctx.fill();

                // Core with holographic shimmer
                const blobCore = ctx.createRadialGradient(blobX, blobY, 0, blobX, blobY, blobR);
                blobCore.addColorStop(0, `hsla(${tBlobHue + 40}, 100%, ${tCoreL1}%, ${0.72 * flicker})`);
                blobCore.addColorStop(0.5, `hsla(${tBlobHue + 20}, 100%, ${tCoreL2}%, ${0.56 * flicker})`);
                blobCore.addColorStop(1, `hsla(${tBlobHue}, 90%, ${tCoreL3}%, 0)`);
                ctx.fillStyle = blobCore;
                ctx.beginPath();
                ctx.arc(blobX, blobY, blobR, 0, Math.PI * 2);
                ctx.fill();
                } else {
                    // --- LIGHT THEME: VOLUMETRIC LIQUID GLASS OVOID ---
                    const t = timeRef.current;
                    const pCenter = project(cube.x, cube.y, cube.z, cx, cy);
                    const pScale = pCenter.scale;

                    // Jelly wobble — radii oscillate slightly for organic feel
                    const wobbleX = 1.0 + Math.sin(t * 1.2 + cube.hue) * 0.03 + Math.sin(t * 2.7) * 0.015;
                    const wobbleY = 1.0 + Math.cos(t * 1.5 + cube.hue) * 0.025 + Math.cos(t * 3.1) * 0.01;
                    const radiusX = s * 1.5 * pScale * wobbleX;
                    const radiusY = s * 1.0 * pScale * wobbleY;

                    // 1. BACK SHELL — Deep fresnel rim for perceived thickness
                    ctx.save();
                    ctx.translate(pCenter.sx, pCenter.sy);
                    ctx.rotate(cube.rz);
                    ctx.beginPath();
                    ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);

                    const fresnel = ctx.createRadialGradient(0, 0, 0, 0, 0, radiusX);
                    fresnel.addColorStop(0, `hsla(${h}, ${tGlassSat}%, 45%, 0)`);
                    fresnel.addColorStop(0.5, `hsla(${h}, ${tGlassSat}%, 35%, ${tGlassA * 0.8})`);
                    fresnel.addColorStop(0.8, `hsla(${h}, ${tGlassSat}%, 20%, ${tGlassA * 2.5})`);
                    fresnel.addColorStop(0.95, `hsla(${h}, ${tGlassSat}%, 12%, ${tGlassA * 4.0})`);
                    fresnel.addColorStop(1, `hsla(${h}, ${tGlassSat}%, 8%, ${tGlassA * 5.5})`);

                    ctx.fillStyle = fresnel;
                    ctx.fill();
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = `hsla(${h}, ${tEdgeSat}%, ${tEdgeLit}%, ${tEdgeA})`;
                    ctx.stroke();
                    ctx.restore();

                    // 2. CAUSTIC LIGHT PATTERNS — animated bright spots on surface
                    ctx.save();
                    ctx.translate(pCenter.sx, pCenter.sy);
                    ctx.rotate(cube.rz);
                    // Clip to ellipse
                    ctx.beginPath();
                    ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
                    ctx.clip();

                    // 3 caustic spots drifting across surface
                    for (let ci = 0; ci < 3; ci++) {
                        const cx2 = Math.sin(t * 0.6 + ci * 2.1) * radiusX * 0.6;
                        const cy2 = Math.cos(t * 0.8 + ci * 1.7) * radiusY * 0.5;
                        const cr = radiusX * (0.25 + Math.sin(t * 1.3 + ci) * 0.1);
                        const caustic = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, cr);
                        caustic.addColorStop(0, `hsla(${h + 10}, 100%, 95%, 0.25)`);
                        caustic.addColorStop(0.5, `hsla(${h}, 90%, 80%, 0.08)`);
                        caustic.addColorStop(1, `hsla(${h}, 80%, 60%, 0)`);
                        ctx.fillStyle = caustic;
                        ctx.beginPath();
                        ctx.arc(cx2, cy2, cr, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.restore();

                    // 3. FIRE CORE (With Dynamic Z-Depth Perception)
                    const [bx3, by3, bz3] = rotatePoint(blob.x * s, blob.y * s, blob.z * s * 0.6, cube.rx, cube.ry, cube.rz);
                    const bProj = project(cube.x + bx3, cube.y + by3, cube.z + bz3, cx, cy);

                    const zNorm = bz3 / s;
                    const depthScale = Math.max(0.3, 1.0 - zNorm * 1.5);
                    const coreOpacity = Math.min(1.0, Math.max(0.1, 1.0 - zNorm * 1.5));

                    const blobR = s * 28 * bProj.scale * 0.012 * depthScale;

                    const blobGlow = ctx.createRadialGradient(bProj.sx, bProj.sy, 0, bProj.sx, bProj.sy, Math.max(1, blobR * 2.5));
                    blobGlow.addColorStop(0, `hsla(${tBlobHue + 20}, 100%, ${tGlowL1}%, ${0.50 * coreOpacity})`);
                    blobGlow.addColorStop(0.4, `hsla(${tBlobHue}, 90%, ${tGlowL2}%, ${0.25 * coreOpacity})`);
                    blobGlow.addColorStop(1, `hsla(${tBlobHue}, 80%, ${tGlowL3}%, 0)`);
                    ctx.fillStyle = blobGlow;
                    ctx.beginPath();
                    ctx.arc(bProj.sx, bProj.sy, Math.max(1, blobR * 2.5), 0, Math.PI * 2);
                    ctx.fill();

                    const blobCore = ctx.createRadialGradient(bProj.sx, bProj.sy, 0, bProj.sx, bProj.sy, Math.max(1, blobR));
                    blobCore.addColorStop(0, `hsla(${tBlobHue + 40}, 100%, ${tCoreL1}%, ${0.9 * coreOpacity})`);
                    blobCore.addColorStop(0.5, `hsla(${tBlobHue + 20}, 100%, ${tCoreL2}%, ${0.7 * coreOpacity})`);
                    blobCore.addColorStop(1, `hsla(${tBlobHue}, 90%, ${tCoreL3}%, 0)`);
                    ctx.fillStyle = blobCore;
                    ctx.beginPath();
                    ctx.arc(bProj.sx, bProj.sy, Math.max(1, blobR), 0, Math.PI * 2);
                    ctx.fill();

                    // 4. SURFACE PULSES — 3 sparks on different orbits across the 3D surface
                    // Each pulse travels a unique great-circle path: parallel, meridian, diagonal
                    ctx.save();
                    ctx.translate(pCenter.sx, pCenter.sy);
                    ctx.rotate(cube.rz);
                    ctx.beginPath();
                    ctx.ellipse(0, 0, radiusX * 1.02, radiusY * 1.02, 0, 0, Math.PI * 2);
                    ctx.clip();

                    // Orbit definitions: [tiltAngle, speedMult, phaseOffset]
                    // tilt 0 = equator (parallel), π/2 = meridian, other = diagonal
                    const orbits: [number, number, number][] = [
                        [0.15, 0.12, 0],           // near-equator (parallel)
                        [Math.PI * 0.45, 0.10, 2.1],  // near-meridian
                        [Math.PI * 0.25, 0.14, 4.3],  // diagonal
                    ];

                    for (let pi = 0; pi < 3; pi++) {
                        const [tilt, spd, phase] = orbits[pi];
                        const angle = t * spd + phase + cube.hue * 0.03;

                        // Point on tilted great circle, projected to 2D ellipse
                        const cx3d = Math.cos(angle);
                        const cy3d = Math.sin(angle) * Math.cos(tilt);
                        const cz3d = Math.sin(angle) * Math.sin(tilt);

                        // Project 3D sphere point onto 2D ellipse surface
                        const px2 = cx3d * radiusX * 0.85;
                        const py2 = cy3d * radiusY * 0.85;
                        // z-depth affects size and brightness (closer = bigger/brighter)
                        const depthFactor = 0.5 + cz3d * 0.5; // 0..1
                        const pr = (4 + Math.sin(t * 0.8 + pi * 1.5) * 2) * (0.6 + depthFactor * 0.6);
                        const pAlpha = 0.4 + depthFactor * 0.45; // brighter than gold dust, dimmer than blob

                        const pGrad = ctx.createRadialGradient(px2, py2, 0, px2, py2, pr);
                        pGrad.addColorStop(0, `hsla(${h + 15}, 100%, 95%, ${pAlpha})`);
                        pGrad.addColorStop(0.35, `hsla(${h}, 95%, 78%, ${pAlpha * 0.45})`);
                        pGrad.addColorStop(1, `hsla(${h}, 80%, 60%, 0)`);
                        ctx.fillStyle = pGrad;
                        ctx.beginPath();
                        ctx.arc(px2, py2, pr, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.restore();

                    // 5. INTERNAL TEXT — bold with strong contrast
                    const ptTL = rotatePoint(-s*1.2, -s*0.8, 0, 0, 0, cube.rz);
                    const ptTR = rotatePoint( s*1.2, -s*0.8, 0, 0, 0, cube.rz);
                    const ptBL = rotatePoint(-s*1.2,  s*0.8, 0, 0, 0, cube.rz);

                    const pTL = project(cube.x + ptTL[0], cube.y + ptTL[1], cube.z + ptTL[2], cx, cy);
                    const pTR = project(cube.x + ptTR[0], cube.y + ptTR[1], cube.z + ptTR[2], cx, cy);
                    const pBL = project(cube.x + ptBL[0], cube.y + ptBL[1], cube.z + ptBL[2], cx, cy);

                    const lw = 2400; const lh = 1600;
                    const m11 = (pTR.sx - pTL.sx) / lw;
                    const m12 = (pTR.sy - pTL.sy) / lw;
                    const m21 = (pBL.sx - pTL.sx) / lh;
                    const m22 = (pBL.sy - pTL.sy) / lh;

                    ctx.save();
                    ctx.transform(m11, m12, m21, m22, pTL.sx, pTL.sy);

                    ctx.font = '900 420px Inter, system-ui, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';

                    // Deep shadow for contrast
                    ctx.fillStyle = `hsla(${h}, 80%, 10%, 0.85)`;
                    ctx.fillText(cube.label.toUpperCase(), lw/2, (lh/2) + 18, lw * 0.85);

                    // Bright foreground with glow
                    ctx.shadowColor = `hsla(${h}, 100%, 85%, 0.6)`;
                    ctx.shadowBlur = 15;
                    ctx.fillStyle = `hsla(${h}, 20%, 100%, 1.0)`;
                    ctx.fillText(cube.label.toUpperCase(), lw/2, lh/2, lw * 0.85);
                    ctx.shadowBlur = 0;
                    ctx.restore();

                    // 5. FRONT GLOSS with moving specular highlight
                    ctx.save();
                    ctx.translate(pCenter.sx, pCenter.sy);
                    ctx.rotate(cube.rz);

                    ctx.beginPath();
                    ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);

                    // Moving highlight position (like sun reflecting off bubble)
                    const hlX = Math.sin(t * 0.4 + cube.hue * 0.1) * radiusX * 0.3;
                    const hlY = -radiusY * 0.35 + Math.cos(t * 0.5) * radiusY * 0.1;

                    const glassGrad = ctx.createRadialGradient(hlX, hlY, 0, 0, 0, radiusX);
                    glassGrad.addColorStop(0, `hsla(${h + 10}, 100%, 100%, 0.75)`);
                    glassGrad.addColorStop(0.1, `hsla(${h}, ${tGlassSat}%, 95%, 0.3)`);
                    glassGrad.addColorStop(0.4, `hsla(${h}, ${tGlassSat}%, ${tGlassLit}%, ${tGlassA * 0.3})`);
                    glassGrad.addColorStop(0.85, `hsla(${h}, ${tGlassSat}%, 10%, ${tGlassA * 0.15})`);
                    glassGrad.addColorStop(1, `hsla(${h}, ${tGlassSat}%, 100%, 0.2)`);
                    ctx.fillStyle = glassGrad;
                    ctx.fill();

                    // Specular arc — follows highlight position
                    ctx.beginPath();
                    const arcStart = Math.PI + Math.sin(t * 0.3) * 0.3;
                    ctx.ellipse(0, 0, radiusX * 0.92, radiusY * 0.92, 0, arcStart, arcStart + Math.PI * 0.4);
                    ctx.strokeStyle = `hsla(0, 0%, 100%, 0.7)`;
                    ctx.lineWidth = 2.5;
                    ctx.stroke();
                    ctx.restore();
                }
            }

            rafRef.current = requestAnimationFrame(draw);
        };

        rafRef.current = requestAnimationFrame(draw);
        return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener('resize', resize); };
    }, [active, theme]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                zIndex: 4, // above canvas (z:1), below vignette (z:10)
                pointerEvents: 'none',
            }}
        />
    );
});

GlassCubes.displayName = 'GlassCubes';

export default GlassCubes;
