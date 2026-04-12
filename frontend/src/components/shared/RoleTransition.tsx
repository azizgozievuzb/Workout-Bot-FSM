import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../../contexts/ThemeContext';
import PromoCodeModal from './PromoCodeModal';
import '../../styles/role-transition.css';

type Phase = 'idle' | 'exiting' | 'void' | 'entering';

interface RoleTransitionProps {
    view: 'player' | 'responsible';
    dual: boolean;
    onToggle: () => void;
    lockedMessage: string;
    children: React.ReactNode;
}

const VOID_MS = 500;

/* --- Gravity Collapse (dark) — спиральное затягивание в чёрную дыру --- */
const darkVariants = {
    initial: {
        scale: 0,
        opacity: 0,
        rotate: -180,
        scaleX: 0.3,
        y: -40,
        filter: 'blur(6px)',
    },
    animate: {
        scale: 1,
        opacity: 1,
        rotate: 0,
        scaleX: 1,
        y: 0,
        filter: 'blur(0px)',
        transition: {
            duration: 0.7,
            ease: [0.16, 1, 0.3, 1],
            rotate: { duration: 0.8, ease: [0.16, 1, 0.3, 1] },
        },
    },
    exit: {
        scale: 0.1,
        opacity: 0,
        rotate: 180,
        scaleX: 0.15,
        y: -60,
        filter: 'blur(5px)',
        transition: {
            duration: 0.7,
            ease: [0.55, 0, 1, 0.45],
            rotate: { duration: 0.7, ease: [0.76, 0, 0.24, 1] },
            opacity: { duration: 0.5, delay: 0.15 },
        },
    },
};

/* --- Supernova (light) --- */
const lightVariants = {
    initial: { scale: 0.3, opacity: 0, filter: 'blur(12px) brightness(2)', rotate: -5 },
    animate: {
        scale: 1, opacity: 1, filter: 'blur(0px) brightness(1)', rotate: 0,
        transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
    },
    exit: {
        scale: 1.4,
        opacity: 0,
        filter: 'blur(8px) brightness(1.8)',
        rotate: 3,
        transition: { duration: 0.55, ease: [0.22, 0, 0.36, 1] },
    },
};

const RoleTransition: React.FC<RoleTransitionProps> = ({
    view, dual, onToggle, lockedMessage, children,
}) => {
    const theme = useTheme();
    const [phase, setPhase] = useState<Phase>('idle');
    const [showContent, setShowContent] = useState(true);
    const [toast, setToast] = useState(false);
    const [denied, setDenied] = useState(false);
    const [promoOpen, setPromoOpen] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout>>();
    const isFirstRender = useRef(true);
    const prefersReduced = useRef(
        typeof window !== 'undefined'
            ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
            : false
    );
    const transitioning = useRef(false);

    useEffect(() => { isFirstRender.current = false; }, []);
    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

    const handleTap = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (phase !== 'idle' || transitioning.current) return;

        if (!dual) {
            setDenied(true);
            setPromoOpen(true);
            timerRef.current = setTimeout(() => {
                setDenied(false);
            }, 2000);
            return;
        }

        if (prefersReduced.current) {
            transitioning.current = true;
            onToggle();
            setTimeout(() => { transitioning.current = false; }, 100);
            return;
        }

        transitioning.current = true;
        setPhase('exiting');
        setShowContent(false);
    }, [phase, dual, onToggle]);

    const handleExitComplete = useCallback(() => {
        if (phase !== 'exiting') return;
        setPhase('void');
        timerRef.current = setTimeout(() => {
            onToggle();
            setShowContent(true);
            setPhase('entering');
        }, VOID_MS);
    }, [onToggle, phase]);

    const handleAnimComplete = useCallback(() => {
        if (phase === 'entering') {
            setPhase('idle');
            transitioning.current = false;
        }
    }, [phase]);

    const isDark = theme === 'dark';
    const isActive = phase !== 'idle';
    const variants = isDark ? darkVariants : lightVariants;

    return (
        <>
            {/* Toggle button: black hole (dark) / star (light) */}
            <button
                className={[
                    'rt-btn',
                    isDark ? 'rt-dark' : 'rt-light',
                    dual ? 'rt-dual' : 'rt-single',
                    isActive ? 'rt-active' : '',
                    denied ? 'rt-denied' : '',
                ].filter(Boolean).join(' ')}
                onClick={handleTap}
            >
                <span className="rt-letter">{view === 'player' ? 'P' : 'R'}</span>
                <span className="rt-ring" />
            </button>

            {/* Void overlay — visible between exit and enter */}
            <AnimatePresence>
                {phase === 'void' && (
                    <motion.div
                        className={`rt-void ${isDark ? 'rt-void-dark' : 'rt-void-light'}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                    />
                )}
            </AnimatePresence>

            {/* Animated content */}
            <AnimatePresence mode="wait" onExitComplete={handleExitComplete}>
                {showContent && (
                    <motion.div
                        key={view}
                        className="rt-content"
                        variants={variants}
                        initial={isFirstRender.current ? false : 'initial'}
                        animate="animate"
                        exit="exit"
                        onAnimationComplete={handleAnimComplete}
                        style={{
                            transformOrigin: isDark ? '42px 36px' : 'center center',
                        }}
                    >
                        {children}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Promo code modal instead of toast */}
            <PromoCodeModal
                open={promoOpen}
                onClose={() => setPromoOpen(false)}
                targetRole={view === 'player' ? 'responsible' : 'player'}
                onSuccess={() => {
                    setPromoOpen(false);
                    // After adding role, toggle to the new view
                    onToggle();
                }}
            />
        </>
    );
};

export default RoleTransition;
