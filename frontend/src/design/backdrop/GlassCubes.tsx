import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

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
        const hues = theme === 'dark'
            ? [210, 270, 190]   // blue, purple, cyan
            : [45, 35, 55];     // gold, amber, warm

        // Fixed starting positions: spread across full screen
        const startPos = [
            { x: -0.6, y: -0.85 },  // top-left
            { x:  0.5, y:  0.80 },  // bottom-right
            { x:  0.0, y:  0.05 },  // center
        ];

        const labels = ['Arsenal', 'Workout', 'Responsibility'];

        cubesRef.current = Array.from({ length: count }, (_, i) => ({
            label: labels[i % labels.length],
            x: startPos[i % 3].x + (Math.random() - 0.5) * 0.15,
            y: startPos[i % 3].y + (Math.random() - 0.5) * 0.15,
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
    }, [count, theme]);

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

            for (const cube of cubes) {
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

                // 6 faces: [vertices indices, text mapping pts, logical dimensions]
                // textPts = [TopLeft, TopRight, BottomLeft]
                const faces: { idx: number[], textPts?: number[], logW?: number, logH?: number }[] = [
                    { idx: [0,1,2,3], textPts: [0,1,3], logW: 3000, logH: 2000 }, // front
                    { idx: [4,5,6,7], textPts: [5,4,6], logW: 3000, logH: 2000 }, // back
                    { idx: [0,4,7,3] }, // left
                    { idx: [1,5,6,2] }, // right
                    { idx: [0,1,5,4] }, // top
                    { idx: [3,2,6,7] }, // bottom
                ];

                // Compute face normals for basic backface culling + shading
                const faceData = faces.map(face => {
                    const [a, b, c] = face.idx;
                    const [ax, ay] = rotated[a];
                    const [bx, by] = rotated[b];
                    const [cx2, cy2] = rotated[c];
                    // Normal via cross product (only need Z for backface culling)
                    const nz = (bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax);
                    // View direction is (0,0,-1)
                    const dot = -nz;
                    return { ...face, dot, normalZ: nz };
                });

                // Sort faces back to front
                faceData.sort((a, b) => {
                    const avgZA = a.idx.reduce((s, i) => s + rotated[i][2], 0) / 4;
                    const avgZB = b.idx.reduce((s, i) => s + rotated[i][2], 0) / 4;
                    return avgZB - avgZA;
                });

                // (tokens moved to outer scope)

                for (const face of faceData) {
                    const pts = face.idx.map(i => projected[i]);

                    ctx.beginPath();
                    ctx.moveTo(pts[0].sx, pts[0].sy);
                    pts.slice(1).forEach(p => ctx.lineTo(p.sx, p.sy));
                    ctx.closePath();

                    // Face fill — Extra glossy glass
                    const brightness = Math.max(0, face.dot) * 0.5 + 0.5;
                    const faceAlpha = tGlassA * brightness;
                    
                    if (isDark) {
                        ctx.fillStyle = `hsla(${h}, ${tGlassSat}%, ${tGlassLit}%, ${faceAlpha})`;
                    } else {
                        // Extreme Gloss for Light Theme: Diagonal glare gradient across every face
                        let minX = pts[0].sx, minY = pts[0].sy, maxX = pts[0].sx, maxY = pts[0].sy;
                        for (let i = 1; i < pts.length; i++) {
                            if (pts[i].sx < minX) minX = pts[i].sx;
                            if (pts[i].sx > maxX) maxX = pts[i].sx;
                            if (pts[i].sy < minY) minY = pts[i].sy;
                            if (pts[i].sy > maxY) maxY = pts[i].sy;
                        }
                        // +80% Glossiness: dual specular highlights + extreme intensity
                        const glassGrad = ctx.createLinearGradient(minX, minY, maxX, maxY);
                        glassGrad.addColorStop(0, `hsla(${h}, ${tGlassSat}%, 100%, ${faceAlpha * 4.0})`); // extreme primary glare
                        glassGrad.addColorStop(0.12, `hsla(${h}, ${tGlassSat}%, ${tGlassLit}%, ${faceAlpha})`); // glass body
                        glassGrad.addColorStop(0.85, `hsla(${h}, ${tGlassSat}%, ${tGlassLit - 20}%, ${faceAlpha * 0.7})`); // deep shadow
                        glassGrad.addColorStop(1, `hsla(${h}, ${tGlassSat}%, 100%, ${faceAlpha * 2.5})`); // secondary bottom shine
                        ctx.fillStyle = glassGrad;
                    }
                    ctx.fill();

                    // Sheen gradient on top faces
                    if (face.dot > 0.1) {
                        const p0 = pts[0], p2 = pts[2];
                        const grad = ctx.createLinearGradient(p0.sx, p0.sy, p2.sx, p2.sy);
                        const stopWidth = isDark ? 0.4 : 0.02; // Knife-sharp 0.02 top gloss reflection
                        grad.addColorStop(0, `hsla(${h + 30}, 90%, ${tSheenL1}%, ${tSheenA * brightness})`);
                        grad.addColorStop(stopWidth, `hsla(${h}, 70%, ${tSheenL2}%, ${tSheenA * 0.3 * brightness})`);
                        grad.addColorStop(1, `hsla(${h}, 60%, ${tSheenL3}%, 0)`);
                        ctx.fillStyle = grad;

                        ctx.beginPath();
                        ctx.moveTo(pts[0].sx, pts[0].sy);
                        pts.slice(1).forEach(p => ctx.lineTo(p.sx, p.sy));
                        ctx.closePath();
                        ctx.fill();
                    }

                    // --- DRAW TEXT ON LATERAL FACES ---
                    if (face.textPts && face.logW && face.logH) {
                        const [pTL, pTR, pBL] = face.textPts.map((i: number) => projected[i]);
                        const lw = face.logW;
                        const lh = face.logH;
                        
                        const m11 = (pTR.sx - pTL.sx) / lw;
                        const m12 = (pTR.sy - pTL.sy) / lw;
                        const m21 = (pBL.sx - pTL.sx) / lh;
                        const m22 = (pBL.sy - pTL.sy) / lh;
                        
                        ctx.save();
                        // Text opacity scales smoothly based on brightness/angle. 
                        // It will appear naturally mirrored from behind!
                        const textAlpha = tTextBaseA * Math.max(0.1, face.dot + 0.6);
                        
                        ctx.transform(m11, m12, m21, m22, pTL.sx, pTL.sy);
                        
                        ctx.font = '800 350px Inter, system-ui, sans-serif'; 
                        ctx.fillStyle = `hsla(${h}, ${tTextSat}%, ${tTextLit}%, ${textAlpha})`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        
                        // Shrink to fit width if necessary
                        ctx.fillText(cube.label.toUpperCase(), lw / 2, lh / 2, lw * 0.85);
                        ctx.restore();
                    }

                    // Edge glow
                    ctx.strokeStyle = `hsla(${h}, ${tEdgeSat}%, ${tEdgeLit}%, ${tEdgeA * Math.max(0.3, brightness)})`;
                    ctx.lineWidth = 0.8;
                    ctx.stroke();
                }

                // --- ENERGY BLOB inside cube ---
                // Project blob position
                const [bx3, by3, bz3] = rotatePoint(
                    blob.x * s, blob.y * s, blob.z * s * 0.6,
                    cube.rx, cube.ry, cube.rz
                );
                const bProj = project(cube.x + bx3, cube.y + by3, cube.z + bz3, cx, cy);

                const blobR = s * 28 * bProj.scale * 0.012;
                const blobX = bProj.sx;
                const blobY = bProj.sy;

                // Outer glow
                const blobGlow = ctx.createRadialGradient(blobX, blobY, 0, blobX, blobY, blobR * 2.5);
                blobGlow.addColorStop(0, `hsla(${tBlobHue + 20}, 100%, ${tGlowL1}%, 0.40)`);
                blobGlow.addColorStop(0.4, `hsla(${tBlobHue}, 90%, ${tGlowL2}%, 0.20)`);
                blobGlow.addColorStop(1, `hsla(${tBlobHue}, 80%, ${tGlowL3}%, 0)`);
                ctx.fillStyle = blobGlow;
                ctx.beginPath();
                ctx.arc(blobX, blobY, blobR * 2.5, 0, Math.PI * 2);
                ctx.fill();

                // Core
                const blobCore = ctx.createRadialGradient(blobX, blobY, 0, blobX, blobY, blobR);
                blobCore.addColorStop(0, `hsla(${tBlobHue + 40}, 100%, ${tCoreL1}%, 0.72)`);
                blobCore.addColorStop(0.5, `hsla(${tBlobHue + 20}, 100%, ${tCoreL2}%, 0.56)`);
                blobCore.addColorStop(1, `hsla(${tBlobHue}, 90%, ${tCoreL3}%, 0)`);
                ctx.fillStyle = blobCore;
                ctx.beginPath();
                ctx.arc(blobX, blobY, blobR, 0, Math.PI * 2);
                ctx.fill();
                } else {
                    // --- LIGHT THEME: GLOSSY ELLIPSOID & VOLUMETRIC TEXT ---
                    const pCenter = project(cube.x, cube.y, cube.z, cx, cy);
                    const pScale = pCenter.scale;
                    
                    const radiusX = s * 1.5 * pScale;
                    const radiusY = s * 1.0 * pScale;
                    
                    // 1. BACK SHELL & FRESNEL RIM SHADOW
                    ctx.save();
                    ctx.translate(pCenter.sx, pCenter.sy);
                    ctx.rotate(cube.rz);
                    ctx.beginPath();
                    ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
                    
                    const fresnel = ctx.createRadialGradient(0, 0, 0, 0, 0, radiusX);
                    fresnel.addColorStop(0, `hsla(${h}, ${tGlassSat}%, 35%, 0)`); // hollow core
                    fresnel.addColorStop(0.6, `hsla(${h}, ${tGlassSat}%, 30%, ${tGlassA * 1.0})`); // glass body
                    fresnel.addColorStop(0.95, `hsla(${h}, ${tGlassSat}%, 15%, ${tGlassA * 3.5})`); // physical thick rim
                    fresnel.addColorStop(1, `hsla(${h}, ${tGlassSat}%, 10%, ${tGlassA * 5.0})`); // dark edge
                    
                    ctx.fillStyle = fresnel;
                    ctx.fill();
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = `hsla(${h}, ${tEdgeSat}%, ${tEdgeLit}%, ${tEdgeA})`;
                    ctx.stroke();
                    ctx.restore();

                    // 2. FIRE CORE (With Dynamic Z-Depth Perception)
                    const [bx3, by3, bz3] = rotatePoint(blob.x * s, blob.y * s, blob.z * s * 0.6, cube.rx, cube.ry, cube.rz);
                    const bProj = project(cube.x + bx3, cube.y + by3, cube.z + bz3, cx, cy);
                    
                    // bz3 / s is roughly -0.5 to 0.5. Scale shrinks heavily as it recedes into the "heavy jelly"
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
                    
                    // 3. INTERNAL TEXT (Rigidly attached, no 3D flip distortion)
                    // We render a single flat text plane that spins gracefully with the capsule's Z-axis.
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
                    
                    ctx.font = '800 400px Inter, system-ui, sans-serif'; 
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    
                    // Faux drop-shadow thickness for depth embedded inside the solid glass
                    ctx.fillStyle = `hsla(${h}, ${tTextSat}%, 20%, 0.7)`; 
                    ctx.fillText(cube.label.toUpperCase(), lw/2, (lh/2) + 15, lw * 0.85);

                    // Front crisp text
                    ctx.fillStyle = `hsla(${h}, ${tTextSat}%, 98%, 0.95)`; 
                    ctx.fillText(cube.label.toUpperCase(), lw/2, lh/2, lw * 0.85);
                    ctx.restore();

                    // 4. FRONT GLOSS OVERLAY (+80% Glossiness)
                    ctx.save();
                    ctx.translate(pCenter.sx, pCenter.sy);
                    ctx.rotate(cube.rz);
                    
                    ctx.beginPath();
                    ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
                    
                    const glassGrad = ctx.createLinearGradient(-radiusX, -radiusY, radiusX, radiusY);
                    glassGrad.addColorStop(0, `hsla(${h}, ${tGlassSat}%, 100%, 0.85)`); // Primary glare
                    glassGrad.addColorStop(0.15, `hsla(${h}, ${tGlassSat}%, ${tGlassLit}%, ${tGlassA * 0.4})`); // body
                    glassGrad.addColorStop(0.85, `hsla(${h}, ${tGlassSat}%, 10%, ${tGlassA * 0.2})`); // shadow
                    glassGrad.addColorStop(1, `hsla(${h}, ${tGlassSat}%, 100%, 0.6)`); // Bounce secondary shine
                    ctx.fillStyle = glassGrad;
                    ctx.fill();
                    
                    // Super sharp knife-edge specular arc along the top lip
                    ctx.beginPath();
                    ctx.ellipse(0, 0, radiusX * 0.95, radiusY * 0.95, 0, Math.PI, Math.PI * 1.5);
                    ctx.strokeStyle = `hsla(0, 0%, 100%, 0.8)`;
                    ctx.lineWidth = 3.0; // thicker edge trace
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
