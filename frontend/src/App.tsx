import React, { useState, useRef, useCallback } from 'react';
import { motion, useAnimation, type PanInfo } from 'framer-motion';
import Backdrop from './design/backdrop/Backdrop';
import type { GlassCubesHandle } from './design/backdrop/GlassCubes';
import './App.css';

// --- Типы ---
type LayoutMode = 'chaos' | 'fullscreen' | 'dashboard';
type ModuleName = 'Workout' | 'Arsenal' | 'Responsibility';

// --- Константы таймеров (мс) ---
const TAP_MAX = 300;
const HOLD_DASHBOARD = 2500; // 2.5 сек → toggle dashboard

const App: React.FC = () => {
    const [theme, setTheme] = useState<'dark' | 'light'>('dark');
    const [layoutMode, setLayoutMode] = useState<LayoutMode>('chaos');
    const [activeModule, setActiveModule] = useState<ModuleName | null>(null);

    const cubesRef = useRef<GlassCubesHandle>(null);
    const contentRef = useRef<HTMLElement>(null);
    const controls = useAnimation();

    // --- Gesture state ---
    const pointerDownAt = useRef<number>(0);
    const pointerPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const holdFired = useRef<boolean>(false); // true если таймер удержания уже сработал
    const layoutModeRef = useRef<LayoutMode>('chaos');

    const setLayout = useCallback((mode: LayoutMode) => {
        layoutModeRef.current = mode;
        setLayoutMode(mode);
    }, []);

    const clearTimers = useCallback(() => {
        if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    }, []);

    // --- Тап/удержание на gesture-layer ---
    const handleGestureDown = useCallback((e: React.PointerEvent) => {
        pointerDownAt.current = Date.now();
        holdFired.current = false;

        const rect = contentRef.current?.getBoundingClientRect();
        if (rect) {
            pointerPos.current = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
            };
        }

        clearTimers();

        // Удержание 2.5с → toggle: chaos↔dashboard
        holdTimer.current = setTimeout(() => {
            holdFired.current = true;
            const cur = layoutModeRef.current;
            if (cur === 'chaos') {
                setLayout('dashboard');
                setActiveModule(null);
            } else {
                setLayout('chaos');
                setActiveModule(null);
            }
        }, HOLD_DASHBOARD);
    }, [clearTimers, setLayout]);

    const handleGestureUp = useCallback(() => {
        const elapsed = Date.now() - pointerDownAt.current;
        clearTimers();

        if (elapsed < TAP_MAX) {
            const cur = layoutModeRef.current;

            if (cur === 'chaos') {
                // Тап по кубу → fullscreen, тап в пустоту → ничего
                const hit = cubesRef.current?.checkHit(pointerPos.current.x, pointerPos.current.y);
                if (hit) {
                    setLayout('fullscreen');
                    setActiveModule(hit.label as ModuleName);
                }
            } else {
                // Тап в любом другом режиме → назад в chaos
                setLayout('chaos');
                setActiveModule(null);
            }
        }
    }, [clearTimers, setLayout]);

    // --- Pan End (свайп для смены темы — framer-motion) ---
    const handlePanEnd = useCallback((_event: any, info: PanInfo) => {
        const holdDuration = Date.now() - pointerDownAt.current;
        const isLongPress = holdDuration > 500;
        const isStrongSwipeUp = info.offset.y < -100;

        if (isLongPress && isStrongSwipeUp) {
            setTheme(prev => prev === 'dark' ? 'light' : 'dark');
        }

        controls.start({ scale: 0.75, transition: { duration: 0.3 } });
    }, [controls]);

    // --- Pointer Down на mobile-frame (только для scale-анимации) ---
    const handleFrameDown = useCallback(() => {
        controls.start({ scale: 0.72, transition: { duration: 0.4 } });
    }, [controls]);

    const handleFrameUp = useCallback(() => {
        controls.start({ scale: 0.75, transition: { duration: 0.3 } });
    }, [controls]);

    // --- Кнопка «Назад» ---
    const handleClose = useCallback(() => {
        setLayout('chaos');
        setActiveModule(null);
    }, [setLayout]);

    return (
        <div className={`app-container ${theme}-theme`}>
            <motion.div
                className="mobile-frame"
                initial={{ scale: 0.75 }}
                animate={controls}
                onPointerDown={handleFrameDown}
                onPointerUp={handleFrameUp}
                onPanEnd={handlePanEnd}
                style={{ cursor: 'grab', touchAction: 'none' }}
            >
                {/* СТАТУС БАР */}
                <div className="status-bar">
                    <span className="time">9:41</span>
                    <div className="icons">
                        <span className="signal">📶</span>
                        <span className="battery">🔋</span>
                    </div>
                </div>

                {/* ОСНОВНОЙ КОНТЕНТ */}
                <main className="content" ref={contentRef}>
                    <Backdrop ref={cubesRef} theme={theme} />

                    {/* GESTURE LAYER — всегда активен, ловит тапы и удержания */}
                    <div
                        className="gesture-layer"
                        onPointerDown={handleGestureDown}
                        onPointerUp={handleGestureUp}
                    />

                    {/* UI OVERLAY — DOM поверх 3D */}
                    <div className="ui-overlay" style={{ pointerEvents: layoutMode !== 'chaos' ? 'auto' : 'none' }}>

                        {/* === FULLSCREEN MODULE === */}
                        {layoutMode === 'fullscreen' && activeModule && (
                            <div className="overlay-fullscreen">
                                <div className="overlay-title">{activeModule}</div>
                                <div className="overlay-body">
                                    <p style={{ opacity: 0.5 }}>Модуль «{activeModule}» — Шаг 3</p>
                                </div>
                            </div>
                        )}

                        {/* === DASHBOARD === */}
                        {layoutMode === 'dashboard' && (
                            <div className="overlay-dashboard">
                                <button className="overlay-close" onClick={handleClose}>✕</button>
                                {(['Workout', 'Arsenal', 'Responsibility'] as ModuleName[]).map(mod => (
                                    <div
                                        key={mod}
                                        className="dashboard-card"
                                        onPointerDown={handleGestureDown}
                                        onPointerUp={handleGestureUp}
                                        onClick={() => {
                                            // Не открывать модуль если сработало удержание (переход в chaos)
                                            if (holdFired.current) return;
                                            setLayout('fullscreen');
                                            setActiveModule(mod);
                                        }}
                                    >
                                        <span className="dashboard-card-label">{mod}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </main>
            </motion.div>
        </div>
    );
};

export default App;
