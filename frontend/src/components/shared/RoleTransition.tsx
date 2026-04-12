import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../../contexts/ThemeContext';
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

/* --- Gravity Collapse (dark) --- */
const darkVariants = {
    initial: { scale: 0, opacity: 0, skewX: '8deg' },
    animate: {
        scale: 1, opacity: 1, skewX: '0deg',
        transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
    },
    exit: {
        scale: 0, opacity: 0, skewX: '-5deg',
        transition: { duration: 0.5, ease: [0.55, 0, 1, 0.45] },
    },
};

/* --- Supernova (light) --- */
const lightVariants = {
    initial: { scale: 0.8, opacity: 0, filter: 'blur(8px)' },
    animate: {
        scale: 1, opacity: 1, filter: 'blur(0px)',
        transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
    },
    exit: {
        scale: 1.15, opacity: 0, filter: 'blur(10px)',
        transition: { duration: 0.45, ease: [0.55, 0, 1, 0.45] },
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
    const timerRef = useRef<ReturnType<typeof setTimeout>>();
    const isFirstRender = useRef(true);
    const prefersReduced = useRef(
        typeof window !== 'undefined'
            ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
            : false
    );

    useEffect(() => { isFirstRender.current = false; }, []);
    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

    const handleTap = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (phase !== 'idle') return;

        if (!dual) {
            setDenied(true);
            setToast(true);
            timerRef.current = setTimeout(() => {
                setDenied(false);
                setToast(false);
            }, 2000);
            return;
        }

        if (prefersReduced.current) {
            onToggle();
            return;
        }

        setPhase('exiting');
        setShowContent(false);
    }, [phase, dual, onToggle]);

    const handleExitComplete = useCallback(() => {
        setPhase('void');
        timerRef.current = setTimeout(() => {
            onToggle();
            setShowContent(true);
            setPhase('entering');
        }, VOID_MS);
    }, [onToggle]);

    const handleAnimComplete = useCallback(() => {
        if (phase === 'entering') setPhase('idle');
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
                            transformOrigin: isDark ? '36px 36px' : 'center center',
                        }}
                    >
                        {children}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Denied toast */}
            <AnimatePresence>
                {toast && (
                    <motion.div
                        className="rt-toast"
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                    >
                        {lockedMessage}
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};

export default RoleTransition;
