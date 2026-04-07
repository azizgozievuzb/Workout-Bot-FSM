import React, { useState, useRef } from 'react';
import { motion, useAnimation, type PanInfo } from 'framer-motion';
import Backdrop from './design/backdrop/Backdrop';
import './App.css';

const App: React.FC = () => {
    const [theme, setTheme] = useState<'dark' | 'light'>('dark');
    const pressStartTimeRef = useRef<number>(0);
    const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const controls = useAnimation();

    // СТРОГАЯ ЛОГИКА: Все проверки теперь в PanEnd
    const handlePointerDown = () => {
        if (holdTimer.current) clearTimeout(holdTimer.current);
        pressStartTimeRef.current = Date.now();
        
        holdTimer.current = setTimeout(() => {
            // Визуальный сигнал: удержание засчитано
            controls.start({ scale: 0.72, transition: { duration: 0.4 } });
        }, 500); 
    };

    const handlePanEnd = (_event: any, info: PanInfo) => {
        const holdDuration = Date.now() - pressStartTimeRef.current;
        const isLongPress = holdDuration > 500;
        const isStrongSwipeUp = info.offset.y < -100;
        
        if (isLongPress && isStrongSwipeUp) {
            setTheme((prev: 'dark' | 'light') => prev === 'dark' ? 'light' : 'dark');
        }
        
        // Сброс всего
        if (holdTimer.current) {
            clearTimeout(holdTimer.current);
            holdTimer.current = null;
        }
        pressStartTimeRef.current = 0;
        controls.start({ scale: 0.75, transition: { duration: 0.3 } });
    };

    return (
        <div className={`app-container ${theme}-theme`}>
            {/* МОБИЛЬНАЯ РАМКА СИМУЛЯТОР */}
            <motion.div 
                className="mobile-frame"
                initial={{ scale: 0.75 }} 
                animate={controls}
                onPointerDown={handlePointerDown}
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

                {/* ОСНОВНОЙ КОНТЕНТ (ТОЛЬКО ФОН) */}
                <main className="content">
                    <Backdrop theme={theme} />
                    
                    <div className="ui-overlay">
                        {/* Экран пуст. Прямая блокировка на любые клики. Только Hold & Swipe. */}
                    </div>
                </main>
            </motion.div>
        </div>
    )
}

export default App;
