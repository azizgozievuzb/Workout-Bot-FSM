import React, { useEffect, forwardRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform, AnimatePresence } from 'framer-motion';
import Starfield from './Starfield';
import CloudField from './CloudField';
import GlassCubes, { type GlassCubesHandle } from './GlassCubes';
import './Backdrop.css';

import womanCosmic from '../../assets/test-faces/woman_cosmic.png';
import womanMeditating from '../../assets/test-faces/woman_meditating.png';

interface BackdropProps {
    theme?: 'dark' | 'light';
}

/**
 * BACKDROP 5.1 — Warp Flight + Ghost Face
 *
 * Layer order (back to front):
 *   0. Background color (CSS)
 *   1. Ghost face — fullscreen, semi-transparent, BEHIND particles
 *   2. Canvas (Starfield / CloudField) — particles fly OVER the face
 *   3. Vignette
 */
const Backdrop = forwardRef<GlassCubesHandle, BackdropProps>(({ theme = 'dark' }, ref) => {
    const mouseX = useMotionValue(0.5);
    const mouseY = useMotionValue(0.5);
    const springX = useSpring(mouseX, { stiffness: 25, damping: 30 });
    const springY = useSpring(mouseY, { stiffness: 25, damping: 30 });
    const faceShiftX = useTransform(springX, [0, 1], [-8, 8]);
    const faceShiftY = useTransform(springY, [0, 1], [-8, 8]);

    useEffect(() => {
        const handleMove = (e: MouseEvent | TouchEvent) => {
            const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
            const y = 'touches' in e ? e.touches[0].clientY : e.clientY;
            mouseX.set(x / window.innerWidth);
            mouseY.set(y / window.innerHeight);
        };
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('touchmove', handleMove as EventListener);
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('touchmove', handleMove as EventListener);
        };
    }, [mouseX, mouseY]);

    return (
        <div className={`backdrop-stage ${theme}-mode`}>
            {/* LAYER 1: Ghost face — BEHIND canvas, fullscreen */}
            <motion.div className="face-fullscreen" style={{ x: faceShiftX, y: faceShiftY }}>
                <AnimatePresence mode="wait">
                    <motion.img
                        key={theme}
                        src={theme === 'dark' ? womanCosmic : womanMeditating}
                        alt="Flying Entity"
                        className="face-image"
                        initial={{ opacity: 0, filter: 'blur(12px)' }}
                        animate={{ opacity: 0.15, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, filter: 'blur(12px)' }}
                        transition={{ duration: 1.4, ease: 'easeInOut' }}
                    />
                </AnimatePresence>
            </motion.div>

            {/* LAYER 2: Particles fly OVER the face */}
            {theme === 'dark'
                ? <Starfield speed={1.15} starCount={1200} />
                : <CloudField speed={1.0} />
            }

            {/* LAYER 2.5: Glass cubes with energy blobs */}
            <GlassCubes ref={ref} theme={theme} count={3} />

            {/* LAYER 3: Vignette */}
            <div className="ui-vignette" />
        </div>
    );
});

Backdrop.displayName = 'Backdrop';

export default Backdrop;
