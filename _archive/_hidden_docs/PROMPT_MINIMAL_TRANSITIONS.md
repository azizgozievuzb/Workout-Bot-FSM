# PROMPT: Minimal premium transitions + freeze background on overlay

Two changes. Read CLAUDE.md first.

---

## CHANGE 1 — RoleTransition.tsx: replace animations with pure fade

**File:** `frontend/src/components/shared/RoleTransition.tsx`

### 1a. Replace the VOID_MS constant:
```typescript
const VOID_MS = 120;
```

### 1b. Replace BOTH `darkVariants` and `lightVariants` with a single `fadeVariants`:

Delete the entire `darkVariants` block (lines starting with `/* --- Gravity Collapse...`) and the entire `lightVariants` block. Replace both with:

```typescript
/* --- Minimal fade — premium, no effects --- */
const fadeVariants = {
    initial: { opacity: 0 },
    animate: {
        opacity: 1,
        transition: { duration: 0.25, ease: [0.25, 0, 0, 1] },
    },
    exit: {
        opacity: 0,
        transition: { duration: 0.18, ease: [0.4, 0, 1, 1] },
    },
};
```

### 1c. In the component body, replace:
```typescript
const variants = isDark ? darkVariants : lightVariants;
```
with:
```typescript
const variants = fadeVariants;
```

### 1d. Remove `transformOrigin` from the motion.div (since we no longer use scale/rotate):
```tsx
// Remove this line from the motion.div:
style={{
    transformOrigin: isDark ? '42px 36px' : 'center center',
}}
```
The `<motion.div className="rt-content" ...>` should have NO `style` prop.

### 1e. In role-transition.css — simplify button active state:

Replace `.rt-light.rt-active` block:
```css
.rt-light.rt-active {
    box-shadow:
        0 0 12px rgba(255, 200, 50, 0.4),
        0 0 4px rgba(255, 255, 255, 0.6);
    transform: scale(0.96);
}
```

Replace `.rt-dark.rt-active` (or `.rt-btn.rt-dark.rt-active` — whatever exists):
```css
.rt-dark.rt-active {
    box-shadow:
        0 0 12px rgba(255, 120, 40, 0.4),
        0 0 4px rgba(200, 80, 255, 0.3);
    transform: scale(0.96);
}
```

Delete `@keyframes cas-active-shake` and `@keyframes cas-active` if they exist — no longer used.

### 1f. Simplify void overlay:
The `rt-void-dark` and `rt-void-light` can stay as-is (they're very brief at 120ms now). Or replace `.rt-void-light` and `.rt-void-dark` with a single simple style:
```css
.rt-void {
    position: absolute;
    inset: 0;
    z-index: 20;
    pointer-events: none;
}
.rt-void-dark { background: rgba(0, 0, 0, 0.6); }
.rt-void-light { background: rgba(255, 255, 255, 0.4); }
```
Remove ALL `@keyframes` related to void (void-dark-pulse, void-light-flash, shard-fly-tl, shard-fly-tr, void-light-*). The void is now just a brief flash of color — no animation needed.

---

## CHANGE 2 — Hide background animation when overlay is open

When the user opens a module (fullscreen or dashboard mode), the flying cubes/particles behind the overlay look noisy. They should fade out when any overlay is open.

### 2a. App.tsx — pass `paused` prop to Backdrop:

Find the line: `<Backdrop ref={cubesRef} theme={theme} />`

Replace with: `<Backdrop ref={cubesRef} theme={theme} paused={layoutMode !== 'chaos'} />`

### 2b. Backdrop.tsx — accept `paused` prop and hide animated layers:

Change the interface:
```typescript
interface BackdropProps {
    theme?: 'dark' | 'light';
    paused?: boolean;
}
```

Change the component signature:
```typescript
const Backdrop = forwardRef<GlassCubesHandle, BackdropProps>(({ theme = 'dark', paused = false }, ref) => {
```

Wrap the animated layers (particles + cubes — NOT the ghost face, NOT the vignette) in a fading div:
```tsx
{/* LAYER 2+2.5: Particles + Cubes — hidden when overlay is open */}
<div style={{
    opacity: paused ? 0 : 1,
    transition: 'opacity 0.4s ease',
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
}}>
    {theme === 'dark'
        ? <Starfield speed={1.15} starCount={1200} />
        : <CloudField speed={1.0} />
    }
    <GlassCubes ref={ref} theme={theme} count={is_admin ? 4 : 3} isAdmin={is_admin} />
</div>
```

Remove the old separate `{theme === 'dark' ? <Starfield .../> : <CloudField .../>}` and `<GlassCubes .../>` lines (they are now inside the wrapper div above).

---

## VERIFICATION

```bash
cd frontend && npx tsc --noEmit
```
Must return 0 errors.

## COMMIT

```bash
git add frontend/src/components/shared/RoleTransition.tsx \
        frontend/src/styles/role-transition.css \
        frontend/src/App.tsx \
        frontend/src/design/backdrop/Backdrop.tsx
git commit -m "feat: minimal fade transitions + freeze backdrop on overlay"
git push
```
