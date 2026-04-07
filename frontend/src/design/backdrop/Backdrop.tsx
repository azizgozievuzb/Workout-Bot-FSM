import React, { useMemo, useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform, AnimatePresence } from 'framer-motion';
import { THEME_CONFIG } from '../core/AnimationConfig';
import './Backdrop.css';

// Импортируем лица (теперь WOMAN по умолчанию)
import womanCosmic from '../../assets/test-faces/woman_cosmic.png';
import womanMeditating from '../../assets/test-faces/woman_meditating.png';

interface BackdropProps {
    theme?: 'dark' | 'light';
    character?: 'men' | 'woman';
}

/**
 * BACKDROP 3.0: AI-Integrated Character Entity
 * Swapping MEN for WOMAN as per user request.
 * Optimized transition duration to 1.0s.
 */
const Backdrop: React.FC<BackdropProps> = ({ 
    theme = 'dark'
}) => {
    const config = theme === 'dark' ? THEME_CONFIG.dark : THEME_CONFIG.light;
    
    // ПАРАЛЛАКС ЛОГИКА
    const mouseX = useMotionValue(0.5);
    const mouseY = useMotionValue(0.5);
    const springX = useSpring(mouseX, { stiffness: 45, damping: 25 });
    const springY = useSpring(mouseY, { stiffness: 45, damping: 25 });

    const bgTranslateX = useTransform(springX, [0, 1], [-35, 35]);
    const bgTranslateY = useTransform(springY, [0, 1], [-35, 35]);
    const subjectTranslateX = useTransform(springX, [0, 1], [-18, 18]);
    const subjectTranslateY = useTransform(springY, [0, 1], [-18, 18]);

    useEffect(() => {
        const handleMove = (e: MouseEvent) => {
            mouseX.set(e.clientX / window.innerWidth);
            mouseY.set(e.clientY / window.innerHeight);
        };
        window.addEventListener('mousemove', handleMove);
        return () => window.removeEventListener('mousemove', handleMove);
    }, [mouseX, mouseY]);

    // МЕМОИЗАЦИЯ ОБЛАКОВ / ТУМАННОСТЕЙ
    const blobs = useMemo(() => [...Array(4)].map((_, i) => (
        <motion.div
            key={i}
            className={`motion-blob b-${i}`}
            animate={theme === 'light' ? {
                x: [-140, 140],
                y: [-70, 70],
                scale: [1, 1.4, 1],
                opacity: [0.3, 0.5, 0.3],
            } : {
                scale: [1, 1.25, 1],
                rotate: [0, i % 2 === 0 ? 20 : -20, 0],
                opacity: [0.2, 0.4, 0.2],
            }}
            transition={{
                duration: theme === 'light' ? (15 + i * 5) : (10 + i * 4),
                repeat: Infinity,
                ease: "linear",
            }}
            style={{
                backgroundColor: config.accents[i % config.accents.length],
            }}
        />
    )), [config, theme]);

    return (
        <div className={`backdrop-stage ${theme}-mode`}>
            {/* СЛОЙ 1: ДИНАМИЧЕСКАЯ АТМОСФЕРА */}
            <motion.div 
                className="layer environment-blobs"
                style={{ x: bgTranslateX, y: bgTranslateY }}
            >
                {blobs}
            </motion.div>

            {/* СЛОЙ 2: ПАРЯЩЕЕ ЛИЦО (WOMAN) */}
            <motion.div 
                className="layer avatar-container"
                style={{ x: subjectTranslateX, y: subjectTranslateY }}
                animate={{
                    scale: [1, 1.03, 1],
                }}
                transition={{
                    duration: 8,
                    repeat: Infinity,
                    ease: "easeInOut"
                }}
            >
                <div className="avatar-wrapper">
                    <AnimatePresence mode="wait">
                        <motion.img 
                            key={theme}
                            src={theme === 'dark' ? womanCosmic : womanMeditating} 
                            alt="AI Entity" 
                            className="avatar-image" 
                            initial={{ opacity: 0, filter: 'blur(30px)', scale: 0.8 }}
                            animate={{ opacity: 0.95, filter: 'blur(0px)', scale: 1 }}
                            exit={{ opacity: 0, filter: 'blur(30px)', scale: 0.8 }}
                            transition={{ duration: 1.0, ease: "easeInOut" }} // Ускорили переход
                        />
                    </AnimatePresence>
                    
                    <motion.div 
                        className="avatar-glow"
                        animate={{
                            opacity: [0.1, 0.3, 0.1],
                            scale: [1, 1.3, 1],
                        }}
                        transition={{
                            duration: 8,
                            repeat: Infinity,
                            ease: "easeInOut"
                        }}
                        style={{ backgroundColor: config.glow }}
                    />
                </div>
            </motion.div>

            <div className="ui-vignette" />
        </div>
    );
};

export default Backdrop;
