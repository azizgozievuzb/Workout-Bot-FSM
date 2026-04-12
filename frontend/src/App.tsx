import React, { useState, useRef, useCallback } from 'react';
import Backdrop from './design/backdrop/Backdrop';
import type { GlassCubesHandle } from './design/backdrop/GlassCubes';
import { useAuth } from './hooks/useAuth';
import OnboardingFlow from './components/onboarding/OnboardingFlow';
import PhotoGate from './components/photo-gate/PhotoGate';
import ActionCube from './components/cubes/ActionCube';
import MarketCube from './components/cubes/MarketCube';
import BondCube from './components/cubes/BondCube';
import { ThemeContext } from './contexts/ThemeContext';
import './App.css';

// --- Типы ---
type LayoutMode = 'chaos' | 'fullscreen' | 'dashboard';
type ModuleName = 'Action' | 'Market' | 'Bond';

// --- Константы таймеров (мс) ---
const TAP_MAX = 300;
const HOLD_DASHBOARD = 3000; // 3 сек → toggle dashboard
const SWIPE_UP_THRESHOLD = 80; // px минимальная дистанция свайпа вверх
const HOLD_FOR_SWIPE = 500; // мс минимальное удержание перед свайпом

const App: React.FC = () => {
    const { isLoading, onboardingDone, photoUrl, error, role } = useAuth();
    const [theme, setTheme] = useState<'dark' | 'light'>('dark');
    const [layoutMode, setLayoutMode] = useState<LayoutMode>('chaos');
    const [activeModule, setActiveModule] = useState<ModuleName | null>(null);

    const cubesRef = useRef<GlassCubesHandle>(null);
    const contentRef = useRef<HTMLElement>(null);

    // --- Gesture state ---
    const pointerDownAt = useRef<number>(0);
    const pointerPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const pointerStartY = useRef<number>(0); // для свайпа
    const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const holdFired = useRef<boolean>(false);
    const layoutModeRef = useRef<LayoutMode>('chaos');

    // Определяем, должен ли gesture-layer быть активен
    const hasOverlay = !photoUrl || (!onboardingDone && role === 'player');
    const gestureEnabled = !isLoading && (onboardingDone && !!photoUrl || !!error);

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
        pointerStartY.current = e.clientY;

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

    const handleGestureUp = useCallback((e: React.PointerEvent) => {
        const elapsed = Date.now() - pointerDownAt.current;
        clearTimers();

        // --- Свайп вверх при удержании → смена темы ---
        const deltaY = pointerStartY.current - e.clientY; // положительный = вверх
        if (elapsed > HOLD_FOR_SWIPE && deltaY > SWIPE_UP_THRESHOLD) {
            setTheme(prev => prev === 'dark' ? 'light' : 'dark');
            return; // не обрабатываем как тап
        }

        // --- Тап ---
        if (elapsed < TAP_MAX && !holdFired.current) {
            const cur = layoutModeRef.current;

            if (cur === 'chaos') {
                // Тап по кубу → fullscreen, тап в пустоту → ничего
                const hit = cubesRef.current?.checkHit(pointerPos.current.x, pointerPos.current.y);
                if (hit) {
                    setLayout('fullscreen');
                    setActiveModule(hit.label as ModuleName);
                }
            } else if (cur === 'fullscreen') {
                // Тап в fullscreen → назад в chaos
                setLayout('chaos');
                setActiveModule(null);
            }
            // dashboard: тап НЕ выходит — только long press 3с
        }
    }, [clearTimers, setLayout]);

    // --- Кнопка «Назад» ---
    const handleClose = useCallback(() => {
        setLayout('chaos');
        setActiveModule(null);
    }, [setLayout]);

    return (
        <ThemeContext.Provider value={theme}>
        <div className={`app-container ${theme}-theme`}>
            <div className="app-root">
                {/* ОСНОВНОЙ КОНТЕНТ */}
                <main className="content" ref={contentRef}>
                    <Backdrop ref={cubesRef} theme={theme} />

                    {/* GESTURE LAYER — активен только когда нет оверлеев */}
                    <div
                        className="gesture-layer"
                        onPointerDown={handleGestureDown}
                        onPointerUp={handleGestureUp}
                        style={{ pointerEvents: gestureEnabled ? 'auto' : 'none' }}
                    />

                    {/* PHOTO GATE — обязательное селфи для ВСЕХ пользователей */}
                    {/* Показываем только после загрузки auth (isLoading=false), чтобы кубы не мелькали */}
                    {!isLoading && !error && !photoUrl && <PhotoGate />}

                    {/* Блокируем вид пока auth грузится — чёрный фон без мелькания кубов */}
                    {isLoading && <div className="pg-loading-screen" />}

                    {/* UI OVERLAY — DOM поверх 3D */}
                    <div className="ui-overlay" style={{ pointerEvents: layoutMode !== 'chaos' || hasOverlay ? 'auto' : 'none' }}>

                        {/* === ONBOARDING === */}
                        {!isLoading && !onboardingDone && role === 'player' && !!photoUrl && <OnboardingFlow />}

                        {/* === AUTH ERROR === */}
                        {error && (
                            <div className="onb-loading" style={{ textAlign: 'center', padding: '0 24px' }}>
                                <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 18, marginBottom: 8 }}>
                                    Не удалось войти
                                </p>
                                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, whiteSpace: 'pre-line' }}>
                                    {error}
                                </p>
                            </div>
                        )}

                        {/* === FULLSCREEN MODULE === */}
                        {layoutMode === 'fullscreen' && activeModule && (
                            <div className="overlay-fullscreen">
                                <div className="overlay-title">{activeModule}</div>
                                <div className="overlay-body">
                                    {activeModule === 'Action' && <ActionCube />}
                                    {activeModule === 'Market' && <MarketCube />}
                                    {activeModule === 'Bond' && <BondCube />}
                                </div>
                            </div>
                        )}

                        {/* === DASHBOARD === */}
                        {layoutMode === 'dashboard' && (
                            <div className="overlay-dashboard">
                                <button className="overlay-close" onClick={handleClose}>✕</button>
                                {(['Action', 'Market', 'Bond'] as ModuleName[]).map(mod => (
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
            </div>
        </div>
        </ThemeContext.Provider>
    );
};

export default App;
