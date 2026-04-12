import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type ModuleName = 'Action' | 'Market' | 'Bond';

interface MenuItem {
    icon: string;
    label: string;
    key: string;
    accent?: boolean;
}

interface DashboardSectionProps {
    module: ModuleName;
    onOpen: (sub?: string) => void;
}

const PRIMARY_ITEMS: Record<ModuleName, MenuItem[]> = {
    Action: [
        { icon: '\u{1F3CB}\u{FE0F}', label: 'Начать тренировку', key: 'workout', accent: true },
        { icon: '\u{1F525}', label: '5 дней', key: 'streak' },
    ],
    Market: [
        { icon: '\u2B50', label: '150', key: 'balance' },
        { icon: '\u{1F6D2}', label: 'Магазин', key: 'shop', accent: true },
    ],
    Bond: [
        { icon: '\u{1F4F0}', label: '3 новых', key: 'feed' },
        { icon: '\u{1F464}', label: 'Профиль', key: 'profile' },
    ],
};

const MORE_ITEMS: Record<ModuleName, MenuItem[]> = {
    Action: [
        { icon: '\u{1F4CA}', label: 'Статистика дня', key: 'stats' },
        { icon: '\u{1F634}', label: 'День отдыха', key: 'rest' },
    ],
    Market: [
        { icon: '\u{1F381}', label: 'Лутбоксы', key: 'lootbox' },
    ],
    Bond: [
        { icon: '\u{1F3C6}', label: 'Достижения', key: 'achievements' },
        { icon: '\u2699\u{FE0F}', label: 'Настройки', key: 'settings' },
    ],
};

const DashboardSection: React.FC<DashboardSectionProps> = ({ module, onOpen }) => {
    const [moreOpen, setMoreOpen] = useState(false);

    const handleItem = useCallback((e: React.MouseEvent, key: string) => {
        e.stopPropagation();
        onOpen(key);
    }, [onOpen]);

    const handleMore = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setMoreOpen(prev => !prev);
    }, []);

    const primary = PRIMARY_ITEMS[module];
    const more = MORE_ITEMS[module];

    return (
        <div className="dashboard-section">
            <div className="dashboard-section-title">{module}</div>
            <div className="dashboard-primary">
                {primary.map(item => (
                    <div
                        key={item.key}
                        className={`dashboard-primary-item ${item.accent ? 'accent' : ''}`}
                        onClick={(e) => handleItem(e, item.key)}
                    >
                        <span>{item.icon}</span>
                        <span>{item.label}</span>
                    </div>
                ))}
            </div>
            {more.length > 0 && (
                <>
                    <div className="dashboard-more-toggle" onClick={handleMore}>
                        Ещё <span className={`dashboard-section-arrow ${moreOpen ? 'open' : ''}`}>&#x25BC;</span>
                    </div>
                    <AnimatePresence>
                        {moreOpen && (
                            <motion.div
                                className="dashboard-dropdown"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2, ease: 'easeInOut' }}
                                style={{ overflow: 'hidden' }}
                            >
                                {more.map(item => (
                                    <div
                                        key={item.key}
                                        className="dashboard-dropdown-item"
                                        onClick={(e) => handleItem(e, item.key)}
                                    >
                                        <span>{item.icon}</span>
                                        <span>{item.label}</span>
                                    </div>
                                ))}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </>
            )}
        </div>
    );
};

export default DashboardSection;
