import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Backdrop from './design/backdrop/Backdrop';
import type { GlassCubesHandle } from './design/backdrop/GlassCubes';
import { useAuth } from './hooks/useAuth';
import ThemeCycleButton from './components/shared/ThemeCycleButton';
import { prefetch, CACHE_KEYS } from './api/cache';
import { getMyStats } from './api/stats';
import { getSchedule } from './api/schedule';
import { getPlayerShop } from './api/shop';
import { getFeed } from './api/activityFeed';
import OnboardingFlow from './components/onboarding/OnboardingFlow';
import ScheduleGate from './components/schedule/ScheduleGate';
import PhotoGate from './components/photo-gate/PhotoGate';
import ActionCube from './components/cubes/ActionCube';
import MarketCube from './components/cubes/MarketCube';
import BondCube from './components/cubes/BondCube';
import AdminCube from './components/cubes/AdminCube';
import { ThemeContext } from './contexts/ThemeContext';
import type { AppTheme, ThemeMode } from './contexts/ThemeContext';
import { useAuthStore } from './stores/authStore';
import AccessRevokedScreen from './components/shared/AccessRevokedScreen';
import MaintenanceScreen from './components/shared/MaintenanceScreen';
import BanScreen from './components/shared/BanScreen';
import OnboardingBlockedScreen from './components/shared/OnboardingBlockedScreen';
import './App.css';
import DashboardPanel from './components/shared/DashboardPanel';
import DashboardRoleSwitch from './components/shared/DashboardRoleSwitch';
import PaywallScreen from './components/shared/PaywallScreen';
import RenewalScreen from './components/shared/RenewalScreen';
import './styles/dashboard.css';
import './styles/paywall.css';

// --- Типы ---
type LayoutMode = 'chaos' | 'fullscreen' | 'dashboard';
type ModuleName = 'Action' | 'Market' | 'Bond' | 'Admin';

// --- Константы таймеров (мс) ---
const TAP_MAX = 300;
/* S64-2: удержание на кубах открывает статическую сводку. Порог поднят с 3с,
   чтобы жест не срабатывал случайно; эксклюзивных функций за ним больше нет.
   Одно число в одном месте: им же задаётся длительность индикатора прогресса
   (--hold-ms ниже).
   S64-11 (решение юзера, смоук 23.08): 5000 → 3500 — на живом опыте пять секунд
   держать слишком долго. Ниже стартового диапазона 4000–6000 осознанно. */
const HOLD_DASHBOARD_MS = 3500;
/* Уход пальца в свайп/скролл отменяет удержание (S64-9г): дальше этого сдвига
   жест уже не «держу», а «веду». */
const HOLD_CANCEL_PX = 24;

/* S64-9а: выбор темы — оформление устройства, а не игровая механика, поэтому
   живёт в localStorage, а не в БД. У скрытого жеста сброс при перезаходе никто
   не замечал; у явной кнопки он читался бы как баг. */
const THEME_KEY = 'wb_theme';

function readStoredMode(): ThemeMode {
    try {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved === 'dark' || saved === 'light' || saved === 'auto') return saved;
    } catch { /* приватный режим / отключённое хранилище — молча дефолт */ }
    return 'dark';
}

/* «Как в Telegram» (S66). Клиент отдаёт свою тему в `colorScheme`; если его нет
   (открыли в обычном браузере) — спрашиваем систему через prefers-color-scheme,
   ровно тот же сигнал, что уже используется в index.css. */
function detectClientTheme(): AppTheme {
    const scheme = (window as any).Telegram?.WebApp?.colorScheme;
    if (scheme === 'dark' || scheme === 'light') return scheme;
    try {
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch { return 'dark'; }
}

const NEXT_MODE: Record<ThemeMode, ThemeMode> = {
    light: 'dark',
    dark: 'auto',
    auto: 'light',
};

const carouselVariants = {
    enter: (dir: number) => ({ x: dir ? dir * 300 : 0, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir ? -dir * 300 : 0, opacity: 0 }),
};

const App: React.FC = () => {
    const { isLoading, onboardingDone, photoUrl, error, role } = useAuth();
    const { is_admin, accessRevoked, banInfo, maintenanceMode, onboardingBlocked, onboardingBlockedMessage,
        subscription, has_responsible_access, has_player_access, needsScheduleSetup } = useAuthStore();
    const [themeMode, setThemeMode] = useState<ThemeMode>(readStoredMode);
    const [clientTheme, setClientTheme] = useState<AppTheme>(detectClientTheme);
    const theme: AppTheme = themeMode === 'auto' ? clientTheme : themeMode;
    const [layoutMode, setLayoutMode] = useState<LayoutMode>('chaos');
    const [activeModule, setActiveModule] = useState<ModuleName | null>(null);
    /* Строка сводки «👤 Профиль» / «⚙️ Настройки» обязана открывать сам экран
       профиля, а не просто куб (S64-9в): раньше аргумент `sub` выбрасывался. */
    const [pendingSub, setPendingSub] = useState<string | null>(null);
    // Видимый прогресс удержания (S64-9г): 5 секунд «в никуда» читаются как поломка.
    const [holdActive, setHoldActive] = useState(false);

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
    /* Один жест — один экран. Кулдаун общий для колеса и пальца: смоук 30.08 —
       «сильно свайпнул, карусель прокрутилась на 3-4 экрана». Пока идёт анимация
       перехода (0.25 с), новые свайпы игнорируем. */
    const wheelCooldown = useRef(false);
    const wheelQuietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);


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
        setHoldActive(false);
    }, []);

    const cycleTheme = useCallback(() => {
        setThemeMode(prev => {
            const next = NEXT_MODE[prev];
            try { localStorage.setItem(THEME_KEY, next); } catch { /* см. readStoredMode */ }
            return next;
        });
    }, []);

    /* Следим за темой клиента постоянно, а не только в режиме `auto`: человек
       может переключить тему Telegram, не выходя из мини-аппа, и вернуться в
       `auto` уже с новым значением. Слушаем оба источника — Telegram и систему. */
    useEffect(() => {
        const sync = () => setClientTheme(detectClientTheme());
        const tg = (window as any).Telegram?.WebApp;
        tg?.onEvent?.('themeChanged', sync);
        let mq: MediaQueryList | null = null;
        try {
            mq = window.matchMedia('(prefers-color-scheme: light)');
            mq.addEventListener('change', sync);
        } catch { /* старые webview без addEventListener на MediaQueryList */ }
        return () => {
            tg?.offEvent?.('themeChanged', sync);
            mq?.removeEventListener('change', sync);
        };
    }, []);

    const themeValue = useMemo(
        () => ({ theme, mode: themeMode, cycleTheme }),
        [theme, themeMode, cycleTheme],
    );

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

        // Удержание HOLD_DASHBOARD_MS → chaos→dashboard (только из chaos)
        if (layoutModeRef.current === 'chaos') setHoldActive(true);
        holdTimer.current = setTimeout(() => {
            holdFired.current = true;
            setHoldActive(false);
            if (layoutModeRef.current === 'chaos') {
                setLayout('dashboard');
                setActiveModule(null);
            }
        }, HOLD_DASHBOARD_MS);
    }, [clearTimers, setLayout]);

    /* Палец поехал → это уже не удержание: гасим и таймер, и индикацию (S64-9г). */
    const handleGestureMove = useCallback((e: React.PointerEvent) => {
        if (!holdTimer.current) return;
        const dx = e.clientX - pointerStartX.current;
        const dy = e.clientY - pointerStartY.current;
        if (Math.sqrt(dx * dx + dy * dy) > HOLD_CANCEL_PX) clearTimers();
    }, [clearTimers]);

    const handleGestureUp = useCallback((e: React.PointerEvent) => {
        const elapsed = Date.now() - pointerDownAt.current;
        clearTimers();

        const deltaY = pointerStartY.current - e.clientY; // положительный = вверх
        const deltaX = e.clientX - pointerStartX.current;  // положительный = вправо

        /* S64-4: ветка «удержание + свайп вверх → смена темы» удалена. Тема
           переключается кнопкой ☀️/🌙 на экране профиля (Bond → Профиль). */

        // --- Горизонтальный свайп в fullscreen → карусель ---
        if (layoutModeRef.current === 'fullscreen' && activeModule
            && elapsed < 500 && Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
            if (wheelCooldown.current) return;
            wheelCooldown.current = true;
            setTimeout(() => { wheelCooldown.current = false; }, 400);
            const dir: 1 | -1 = deltaX < 0 ? 1 : -1;
            setSwipeDir(dir);
            setPendingSub(null);
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
                    setPendingSub(null);
                    setLayout('fullscreen');
                    setActiveModule(hit.label as ModuleName);
                }
            }
        }
    }, [clearTimers, setLayout, activeModule, nextMod]);

    /* Тачпад — не палец: один жест порождает поток wheel-событий, который живёт
       ещё 1–2 секунды на инерции. Фиксированный кулдаун 400 мс истекал ПОСРЕДИ
       инерции, и остаток того же жеста прокручивал следующий экран, и следующий
       (смоук 30.08: «на тачпаде промотало несколько экранов, с телефона нормально»).
       Лечится не длиной кулдауна, а его сбросом: таймер перезапускается на КАЖДОМ
       событии, поэтому замок снимается только через 250 мс ТИШИНЫ — то есть когда
       жест реально закончился, а не когда истёк отсчёт. */
    const handleWheel = useCallback((e: React.WheelEvent) => {
        if (layoutModeRef.current !== 'fullscreen' || !activeModule) return;
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
        if (Math.abs(delta) < 30) return;

        const wasLocked = wheelCooldown.current;
        wheelCooldown.current = true;
        if (wheelQuietTimer.current) clearTimeout(wheelQuietTimer.current);
        wheelQuietTimer.current = setTimeout(() => {
            wheelCooldown.current = false;
            wheelQuietTimer.current = null;
        }, 250);
        if (wasLocked) return;

        const dir: 1 | -1 = delta > 0 ? 1 : -1;
        setSwipeDir(dir);
        setPendingSub(null);
        setActiveModule(nextMod(activeModule, dir));
    }, [activeModule, nextMod]);

    /* Прогрев кэша (S66). Первый заход на любой куб всё равно ждал сеть: замер
       S66 — каждый поход сервера в базу ≈0.5 с, экран Market делает два запроса.
       Как только авторизация прошла, тянем данные всех кубов ПАРАЛЛЕЛЬНО и
       заранее — к моменту, когда игрок доберётся до экрана, они уже в памяти.
       Витрина и расписание есть только у игрока: у наставника эти эндпоинты
       отвечают 403, поэтому греем их под флагом доступа. */
    useEffect(() => {
        if (isLoading || error || !photoUrl || !onboardingDone) return;
        prefetch(CACHE_KEYS.feed, () => getFeed(20, 0).then((r) => r.items));
        if (!has_player_access) return;
        prefetch(CACHE_KEYS.myStats, getMyStats);
        prefetch(CACHE_KEYS.schedule, getSchedule);
        prefetch(CACHE_KEYS.playerShop, getPlayerShop);
    }, [isLoading, error, photoUrl, onboardingDone, has_player_access]);

    /* Переход между кубами из вложенных блоков (смоук 30.08: строка «в магазине →»
       в расписании выглядела ссылкой, но никуда не вела). Событие вместо проброса
       колбэка через три уровня — навигация карусели живёт только здесь. */
    useEffect(() => {
        const go = (e: Event) => {
            const target = (e as CustomEvent<string>).detail as ModuleName;
            if (!MODULES.includes(target)) return;
            setSwipeDir(0);
            setPendingSub(null);
            setLayout('fullscreen');
            setActiveModule(target);
        };
        window.addEventListener('app:goto-module', go);
        return () => window.removeEventListener('app:goto-module', go);
    }, [setLayout]);

    // Пока auth не ответил — нейтральный лоадер (без мелькания кубов/контента).
    if (isLoading && !error) {
        return (
            <div className={`app-container ${theme}-theme`}>
                <div className="pg-loading-screen" />
            </div>
        );
    }

    if (banInfo) return <BanScreen info={banInfo} />;
    if (maintenanceMode && !is_admin) return <MaintenanceScreen />;
    if (accessRevoked && !isLoading) {
        return <AccessRevokedScreen />;
    }
    if (onboardingBlocked) {
        return <OnboardingBlockedScreen message={onboardingBlockedMessage} />;
    }

    // Subscription gating (7.5): paywall for new users, renewal for expired Responsibles.
    if (!isLoading && !error && subscription && !subscription.active) {
        if (subscription.is_first_payment && !has_player_access) return <PaywallScreen />;
        if (!subscription.is_first_payment && has_responsible_access) return <RenewalScreen />;
    }

    return (
        <ThemeContext.Provider value={themeValue}>
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
                        onPointerMove={handleGestureMove}
                        onPointerCancel={clearTimers}
                        style={{ pointerEvents: gestureEnabled && layoutMode === 'chaos' ? 'auto' : 'none' }}
                    />

                    {/* Прогресс удержания (S64-9г): пока палец держат — кольцо
                        заполняется ровно за HOLD_DASHBOARD_MS, фон темнеет.
                        Отпустил или повёл пальцем — исчезло, сводка не открылась. */}
                    {holdActive && (
                        <div
                            className="hold-progress"
                            style={{ ['--hold-ms' as string]: `${HOLD_DASHBOARD_MS}ms` } as React.CSSProperties}
                            aria-hidden="true"
                        >
                            <svg className="hold-progress-ring" viewBox="0 0 52 52">
                                <circle className="hold-progress-track" cx="26" cy="26" r="23" />
                                <circle className="hold-progress-fill" cx="26" cy="26" r="23" />
                            </svg>
                        </div>
                    )}

                    {/* PHOTO GATE — обязательное селфи для ВСЕХ пользователей */}
                    {/* Показываем только после загрузки auth (isLoading=false), чтобы кубы не мелькали */}
                    {!isLoading && !error && !photoUrl && <PhotoGate />}

                    {/* Блокируем вид пока auth грузится — чёрный фон без мелькания кубов */}
                    {isLoading && <div className="pg-loading-screen" />}

                    {/* UI OVERLAY — DOM поверх 3D */}
                    <div className="ui-overlay" style={{ pointerEvents: layoutMode !== 'chaos' || hasOverlay ? 'auto' : 'none' }}>

                        {/* === ONBOARDING SURVEY === */}
                        {/* Опрос — ТОЛЬКО для приглашённого игрока (has_player_access), после селфи.
                            Новый неприглашённый юзер видит PaywallScreen (см. выше), не опрос. */}
                        {!isLoading && has_player_access && !onboardingDone && !!photoUrl && <OnboardingFlow />}

                        {/* === SCHEDULE GATE === */}
                        {/* Существующий игрок без main_days (релиз 8a) — довыбор 3 дней. */}
                        {!isLoading && has_player_access && onboardingDone && needsScheduleSetup && !!photoUrl && <ScheduleGate />}

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
                            <div className="overlay-fullscreen" onPointerDown={handleGestureDown} onPointerUp={handleGestureUp} onPointerMove={handleGestureMove} onPointerCancel={clearTimers} onWheel={handleWheel}>
                                <ThemeCycleButton />
                                <button className="overlay-close" onClick={(e) => { e.stopPropagation(); setLayout('chaos'); setActiveModule(null); setPendingSub(null); }} aria-label="Закрыть" />
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
                                        {activeModule === 'Bond' && <BondCube initialSub={pendingSub} />}
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
                                onPointerMove={handleGestureMove}
                                onPointerCancel={clearTimers}
                                /* S64-10 (решение юзера, смоук 23.08): выход со сводки —
                                   ТОЛЬКО крестик. Прежнее закрытие тапом по фону (S64-2г)
                                   удалено целиком, а не починено. */
                            >
                                <ThemeCycleButton />
                                <button className="overlay-close" onClick={(e) => { e.stopPropagation(); setLayout('chaos'); setActiveModule(null); }} aria-label="Закрыть" />
                                <DashboardRoleSwitch />
                                <DashboardPanel onOpen={(mod, sub) => {
                                    setSwipeDir(0);
                                    setPendingSub(sub ?? null);
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
