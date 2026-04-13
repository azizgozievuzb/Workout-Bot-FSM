import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
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

const VOID_MS = 120;

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
    const variants = fadeVariants;

    return (
        <>
            {/* Toggle button: portaled to body to escape carousel transform */}
            {createPortal(
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
                </button>,
                document.body
            )}

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
