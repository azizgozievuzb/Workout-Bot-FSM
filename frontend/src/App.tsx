import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Backdrop from './design/backdrop/Backdrop';
import type { GlassCubesHandle } from './design/backdrop/GlassCubes';
import { useAuth } from './hooks/useAuth';
import OnboardingFlow from './components/onboarding/OnboardingFlow';
import PhotoGate from './components/photo-gate/PhotoGate';
import ActionCube from './components/cubes/ActionCube';
import MarketCube from './components/cubes/MarketCube';
import BondCube from './components/cubes/BondCube';
import AdminCube from './components/cubes/AdminCube';
import { ThemeContext } from './contexts/ThemeContext';
import { useAuthStore } from './stores/authStore';
import AccessRevokedScreen from './components/shared/AccessRevokedScreen';
import MaintenanceScreen from './components/shared/MaintenanceScreen';
import BanScreen from './components/shared/BanScreen';
import OnboardingBlockedScreen from './components/shared/OnboardingBlockedScreen';
import './App.css';
import DashboardPanel from './components/shared/DashboardPanel';
import DashboardRoleSwitch from './components/shared/DashboardRoleSwitch';
import './styles/dashboard.css';

// --- Типы ---
type LayoutMode = 'chaos' | 'fullscreen' | 'dashboard';
type ModuleName = 'Action' | 'Market' | 'Bond' | 'Admin';

// --- Константы таймеров (мс) ---
const TAP_MAX = 300;
const HOLD_DASHBOARD = 3000; // 3 сек → toggle dashboard
const SWIPE_UP_THRESHOLD = 80; // px минимальная дистанция свайпа вверх
const HOLD_FOR_SWIPE = 400; // мс минимальное удержание перед свайпом

const carouselVariants = {
    enter: (dir: number) => ({ x: dir ? dir * 300 : 0, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir ? -dir * 300 : 0, opacity: 0 }),
};

const App: React.FC = () => {
    const { isLoading, onboardingDone, photoUrl, error, role } = useAuth();
    const { is_admin, accessRevoked, banInfo, maintenanceMode, onboardingBlocked, onboardingBlockedMessage } = useAuthStore();
    const [theme, setTheme] = useState<'dark' | 'light'>('dark');
    const [layoutMode, setLayoutMode] = useState<LayoutMode>('chaos');
    const [activeModule, setActiveModule] = useState<ModuleName | null>(null);

    const cubesRef = useRef<GlassCubesHandle>(null);
    const contentRef = useRef<HTMLElement>(null);

    // --- Gesture state ---
    const pointerDownAt = useRef<number>(0);
    const pointerPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const pointerStartX = useRef<number>(0); // для горизонтального свайпа
    const pointerStartY = useRef<number>(0); // для вертикального свайпа
    const [swipeDir, setSwipeDir] = useState<number>(0);
    const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const holdFired = useRef<boolean>(false);
    const layoutModeRef = useRef<LayoutMode>('chaos');
    const wheelCooldown = useRef(false);


    const MODULES: ModuleName[] = is_admin
        ? ['Action', 'Market', 'Bond', 'Admin']
        : ['Action', 'Market', 'Bond'];
    const nextMod = (cur: ModuleName, dir: 1 | -1): ModuleName => {
        const idx = MODULES.indexOf(cur);
        return MODULES[(idx + dir + MODULES.length) % MODULES.length];
    };

    // Определяем, должен ли gesture-layer быть активен
    const isNewUser = role === 'new';
    const hasOverlay = !photoUrl || (!onboardingDone && (role === 'player' || isNewUser));
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
        pointerStartX.current = e.clientX;
        pointerStartY.current = e.clientY;

        clearTimers();

        // Удержание 2.5с → toggle: chaos→dashboard (only from chaos)
        holdTimer.current = setTimeout(() => {
            holdFired.current = true;
            if (layoutModeRef.current === 'chaos') {
                setLayout('dashboard');
                setActiveModule(null);
            }
        }, HOLD_DASHBOARD);
    }, [clearTimers, setLayout]);

    const handleGestureUp = useCallback((e: React.PointerEvent) => {
        const elapsed = Date.now() - pointerDownAt.current;
        clearTimers();

        const deltaY = pointerStartY.current - e.clientY; // положительный = вверх
        const deltaX = e.clientX - pointerStartX.current;  // положительный = вправо

        // --- Hold + swipe up → смена темы (ВСЕ режимы) ---
        if (elapsed > HOLD_FOR_SWIPE && deltaY > SWIPE_UP_THRESHOLD && Math.abs(deltaY) > Math.abs(deltaX)) {
            setTheme(prev => prev === 'dark' ? 'light' : 'dark');
            return;
        }

        // --- Горизонтальный свайп в fullscreen → карусель ---
        if (layoutModeRef.current === 'fullscreen' && activeModule
            && elapsed < 500 && Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
            const dir: 1 | -1 = deltaX < 0 ? 1 : -1;
            setSwipeDir(dir);
            setActiveModule(nextMod(activeModule, dir));
            return;
        }

        // --- Тап ---
        if (elapsed < TAP_MAX && !holdFired.current) {
            const cur = layoutModeRef.current;

            if (cur === 'chaos') {
                const hit = cubesRef.current?.checkHit(pointerPos.current.x, pointerPos.current.y);
                if (hit) {
                    setSwipeDir(0);
                    setLayout('fullscreen');
                    setActiveModule(hit.label as ModuleName);
                }
            }
        }
    }, [clearTimers, setLayout, activeModule, nextMod]);

    const handleWheel = useCallback((e: React.WheelEvent) => {
        if (layoutModeRef.current !== 'fullscreen' || !activeModule || wheelCooldown.current) return;
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
        if (Math.abs(delta) < 30) return;
        wheelCooldown.current = true;
        const dir: 1 | -1 = delta > 0 ? 1 : -1;
        setSwipeDir(dir);
        setActiveModule(nextMod(activeModule, dir));
        setTimeout(() => { wheelCooldown.current = false; }, 400);
    }, [activeModule, nextMod]);

    if (banInfo) return <BanScreen info={banInfo} />;
    if (maintenanceMode && !is_admin) return <MaintenanceScreen />;
    if (accessRevoked && !isLoading) {
        return <AccessRevokedScreen />;
    }
    if (onboardingBlocked) {
        return <OnboardingBlockedScreen message={onboardingBlockedMessage} />;
    }

    return (
        <ThemeContext.Provider value={theme}>
        <div className={`app-container ${theme}-theme`}>
            {maintenanceMode && is_admin && (
                <div
                    className="maintenance-admin-banner"
                    onClick={() => {
                        setSwipeDir(0);
                        setLayout('fullscreen');
                        setActiveModule('Admin');
                    }}
                >
                    🔧 Режим тех. работ активен — нажмите для управления
                </div>
            )}
            <div className="app-root">
                {/* ОСНОВНОЙ КОНТЕНТ */}
                <main className="content" ref={contentRef}>
                    <Backdrop ref={cubesRef} theme={theme} paused={layoutMode !== 'chaos'} />

                    {/* GESTURE LAYER — активен только когда нет оверлеев */}
                    <div
                        className="gesture-layer"
                        onPointerDown={handleGestureDown}
                        onPointerUp={handleGestureUp}
                        style={{ pointerEvents: gestureEnabled && layoutMode === 'chaos' ? 'auto' : 'none' }}
                    />

                    {/* PHOTO GATE — обязательное селфи для ВСЕХ пользователей */}
                    {/* Показываем только после загрузки auth (isLoading=false), чтобы кубы не мелькали */}
                    {!isLoading && !error && !photoUrl && <PhotoGate />}

                    {/* Блокируем вид пока auth грузится — чёрный фон без мелькания кубов */}
                    {isLoading && <div className="pg-loading-screen" />}

                    {/* UI OVERLAY — DOM поверх 3D */}
                    <div className="ui-overlay" style={{ pointerEvents: layoutMode !== 'chaos' || hasOverlay ? 'auto' : 'none' }}>

                        {/* === ONBOARDING === */}
                        {/* role='new' — новый юзер, показываем без фото (фото придёт после промокода) */}
                        {!isLoading && !onboardingDone && (isNewUser || !!photoUrl) && <OnboardingFlow />}

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

                        {/* === FULLSCREEN MODULE (carousel) === */}
                        {layoutMode === 'fullscreen' && activeModule && (
                            <div className="overlay-fullscreen" onPointerDown={handleGestureDown} onPointerUp={handleGestureUp} onWheel={handleWheel}>
                                <button className="overlay-close" onClick={(e) => { e.stopPropagation(); setLayout('chaos'); setActiveModule(null); }} aria-label="Закрыть" />
                                <div className="overlay-title">{activeModule}</div>
                                <AnimatePresence mode="wait" custom={swipeDir}>
                                    <motion.div
                                        key={activeModule}
                                        custom={swipeDir}
                                        variants={carouselVariants}
                                        initial="enter"
                                        animate="center"
                                        exit="exit"
                                        transition={{ duration: 0.25, ease: 'easeInOut' }}
                                        className="overlay-body"
                                    >
                                        {activeModule === 'Action' && <ActionCube />}
                                        {activeModule === 'Market' && <MarketCube />}
                                        {activeModule === 'Bond' && <BondCube />}
                                        {activeModule === 'Admin' && <AdminCube />}
                                    </motion.div>
                                </AnimatePresence>
                                <div className="carousel-dots">
                                    {MODULES.map(m => (
                                        <span key={m} className={`carousel-dot ${m === activeModule ? 'active' : ''}`} />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* === DASHBOARD === */}
                        {/* === DASHBOARD === */}
                        {layoutMode === 'dashboard' && (
                            <div className="overlay-dashboard"
                                onPointerDown={handleGestureDown}
                                onPointerUp={handleGestureUp}
                            >
                                <button className="overlay-close" onClick={(e) => { e.stopPropagation(); setLayout('chaos'); setActiveModule(null); }} aria-label="Закрыть" />
                                <DashboardRoleSwitch />
                                <DashboardPanel onOpen={(mod) => {
                                    setSwipeDir(0);
                                    setLayout('fullscreen');
                                    setActiveModule(mod as ModuleName);
                                }} />
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
