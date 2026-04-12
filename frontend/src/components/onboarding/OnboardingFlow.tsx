import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/client';
import { activatePromo, activatePromoLink } from '../../api/promo';
import { useAuthStore } from '../../stores/authStore';
import './OnboardingFlow.css';

type OnboardingStep = 'promo' | 'congratulations' | 'photo' | 'complete';

const OnboardingFlow: React.FC = () => {
    const [step, setStep] = useState<OnboardingStep>('promo');
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [attemptsLeft, setAttemptsLeft] = useState(3);
    const [lockedMinutes, setLockedMinutes] = useState(0);
    const [grantedRole, setGrantedRole] = useState('');
    const [playerCode, setPlayerCode] = useState('');
    const [responsibleName, setResponsibleName] = useState('');
    const [deepLinkChecked, setDeepLinkChecked] = useState(false);

    const { setAuth, setPlayerCode: storeSetPlayerCode, token } = useAuthStore();
    const lockTimerRef = useRef<ReturnType<typeof setInterval>>();

    // Deep link auto-activation
    useEffect(() => {
        const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
        if (!startParam || deepLinkChecked) return;
        setDeepLinkChecked(true);

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(startParam)) return;

        setLoading(true);
        activatePromoLink(startParam)
            .then((data) => {
                setGrantedRole('player');
                setResponsibleName(data.responsible_name || '');
                handleRoleSuccess('player', '', data.responsible_name || '');
            })
            .catch(() => {
                // Deep link failed — show normal promo input
                setDeepLinkChecked(true);
            })
            .finally(() => setLoading(false));
    }, [deepLinkChecked]);

    // Lock countdown timer
    useEffect(() => {
        if (lockedMinutes <= 0) return;
        lockTimerRef.current = setInterval(() => {
            setLockedMinutes((m) => {
                if (m <= 1) {
                    clearInterval(lockTimerRef.current);
                    return 0;
                }
                return m - 1;
            });
        }, 60000);
        return () => clearInterval(lockTimerRef.current);
    }, [lockedMinutes]);

    const handleRoleSuccess = useCallback((role: string, pCode: string, rName: string) => {
        setGrantedRole(role);
        setStep('congratulations');

        if (role === 'responsible') {
            storeSetPlayerCode(pCode);
            setAuth({
                token: token!,
                role: 'responsible',
                primary_role: 'responsible',
                has_responsible_access: true,
                onboardingDone: false,
            });
        } else if (role === 'player') {
            setAuth({
                token: token!,
                role: 'player',
                primary_role: 'player',
                has_player_access: true,
                onboardingDone: false,
            });
        } else if (role === 'admin') {
            setAuth({
                token: token!,
                role: 'admin',
                is_admin: true,
                has_player_access: true,
                has_responsible_access: true,
                onboardingDone: false,
            });
        }
    }, [token, setAuth, storeSetPlayerCode]);

    const handleActivate = useCallback(async () => {
        if (!code.trim() || loading) return;
        setLoading(true);
        setError('');

        try {
            const data = await activatePromo(code.trim());
            setPlayerCode(data.player_code || '');
            setResponsibleName(data.responsible_name || '');
            handleRoleSuccess(data.role_granted, data.player_code || '', data.responsible_name || '');
        } catch (err: any) {
            const detail = err.response?.data?.detail || 'Ошибка активации';
            setError(detail);

            if (err.response?.status === 429) {
                const match = detail.match(/(\d+)\s*мин/);
                if (match) setLockedMinutes(parseInt(match[1]));
            } else {
                const attMatch = detail.match(/Осталось попыток:\s*(\d+)/);
                if (attMatch) setAttemptsLeft(parseInt(attMatch[1]));
                else if (detail.includes('исчерпали')) setAttemptsLeft(0);
            }
        } finally {
            setLoading(false);
        }
    }, [code, loading, handleRoleSuccess]);

    const handleContinue = useCallback(async () => {
        setStep('photo');
    }, []);

    const handlePhotoDone = useCallback(async () => {
        try {
            await api.put('/users/me', { onboarding_done: true });
        } catch { /* silent */ }
        setAuth({ token: token!, role: grantedRole || 'player', onboardingDone: true });
    }, [token, grantedRole, setAuth]);

    // --- Promo step ---
    if (step === 'promo') {
        const isLocked = lockedMinutes > 0;
        return (
            <div className="onb-container" onClick={(e) => e.stopPropagation()}>
                <div className="promo-screen">
                    <motion.div
                        className="promo-card onb-card"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                    >
                        <h2 className="onb-title">Добро пожаловать</h2>
                        <p className="onb-subtitle">Введите промокод для активации</p>

                        <input
                            className="promo-input onb-input"
                            type="text"
                            autoComplete="off"
                            autoCapitalize="characters"
                            maxLength={12}
                            value={code}
                            onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
                            placeholder="ПРОМОКОД"
                            disabled={isLocked || loading}
                            onClick={(e) => e.stopPropagation()}
                        />

                        {error && <div className="promo-error">{error}</div>}

                        {isLocked ? (
                            <div className="promo-locked">
                                Слишком много попыток. Повторите через {lockedMinutes} мин.
                            </div>
                        ) : (
                            <div className="promo-attempts">
                                Осталось попыток: {attemptsLeft}
                            </div>
                        )}

                        <button
                            className="promo-submit onb-btn onb-btn--accent"
                            onClick={(e) => { e.stopPropagation(); handleActivate(); }}
                            disabled={!code.trim() || isLocked || loading}
                        >
                            {loading ? 'Проверяем...' : 'Активировать'}
                        </button>
                    </motion.div>
                </div>
            </div>
        );
    }

    // --- Congratulations step ---
    if (step === 'congratulations') {
        return (
            <div className="onb-container" onClick={(e) => e.stopPropagation()}>
                <div className="congrats-screen">
                    <motion.div
                        className="onb-card"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.5 }}
                        style={{ textAlign: 'center' }}
                    >
                        <div className="congrats-icon">
                            {grantedRole === 'admin' ? '👑' : '🎉'}
                        </div>
                        <h2 className="congrats-title">
                            {grantedRole === 'responsible' && 'Поздравляю, вы Ответственный!'}
                            {grantedRole === 'player' && 'Поздравляю, вы Игрок!'}
                            {grantedRole === 'admin' && 'Добро пожаловать, Админ'}
                        </h2>

                        {grantedRole === 'player' && responsibleName && (
                            <p className="congrats-role">Ваш Ответственный: {responsibleName}</p>
                        )}

                        {grantedRole === 'responsible' && playerCode && (
                            <div className="congrats-code">
                                <div className="congrats-code-label">Код для вашего Игрока</div>
                                <div className="congrats-code-value">{playerCode}</div>
                                <div className="congrats-code-hint">
                                    Вы найдёте его в разделе Action
                                </div>
                            </div>
                        )}

                        <button
                            className="promo-submit onb-btn onb-btn--accent"
                            onClick={(e) => { e.stopPropagation(); handleContinue(); }}
                            style={{ marginTop: 24 }}
                        >
                            Далее
                        </button>
                    </motion.div>
                </div>
            </div>
        );
    }

    // --- Photo step (reuse existing PhotoGate from App.tsx) ---
    // When step === 'photo', we mark onboarding as needing photo
    // The actual PhotoGate is rendered by App.tsx when !photoUrl
    if (step === 'photo') {
        return (
            <div className="onb-container" onClick={(e) => e.stopPropagation()}>
                <div className="congrats-screen">
                    <motion.div
                        className="onb-card"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                        style={{ textAlign: 'center' }}
                    >
                        <div className="congrats-icon">📸</div>
                        <h2 className="congrats-title">Фото профиля</h2>
                        <p className="onb-subtitle">
                            Сделайте селфи для персонального аватара
                        </p>

                        <button
                            className="promo-submit onb-btn onb-btn--accent"
                            onClick={(e) => { e.stopPropagation(); handlePhotoDone(); }}
                            style={{ marginTop: 24 }}
                        >
                            Открыть приложение
                        </button>
                    </motion.div>
                </div>
            </div>
        );
    }

    return null;
};

export default OnboardingFlow;
