import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type ModuleName = 'Action' | 'Market' | 'Bond';

interface DashboardSectionProps {
    module: ModuleName;
    onOpen: (sub?: string) => void;
}

const MENU_ITEMS: Record<ModuleName, { icon: string; label: string; key: string }[]> = {
    Action: [
        { icon: '\u{1F3CB}\u{FE0F}', label: '\u041D\u0430\u0447\u0430\u0442\u044C \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0443', key: 'workout' },
        { icon: '\u{1F4CA}', label: '\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430 \u0434\u043D\u044F', key: 'stats' },
        { icon: '\u{1F525}', label: '\u041C\u043E\u0439 \u0441\u0442\u0440\u0438\u043A', key: 'streak' },
        { icon: '\u{1F634}', label: '\u0414\u0435\u043D\u044C \u043E\u0442\u0434\u044B\u0445\u0430', key: 'rest' },
    ],
    Market: [
        { icon: '\u{1F6D2}', label: '\u041C\u0430\u0433\u0430\u0437\u0438\u043D', key: 'shop' },
        { icon: '\u2B50', label: '\u041C\u043E\u0439 \u0431\u0430\u043B\u0430\u043D\u0441', key: 'balance' },
        { icon: '\u{1F381}', label: '\u041B\u0443\u0442\u0431\u043E\u043A\u0441\u044B', key: 'lootbox' },
    ],
    Bond: [
        { icon: '\u{1F4F0}', label: '\u041B\u0435\u043D\u0442\u0430 \u0441\u043E\u0431\u044B\u0442\u0438\u0439', key: 'feed' },
        { icon: '\u{1F3C6}', label: '\u0414\u043E\u0441\u0442\u0438\u0436\u0435\u043D\u0438\u044F', key: 'achievements' },
        { icon: '\u{1F464}', label: '\u041F\u0440\u043E\u0444\u0438\u043B\u044C', key: 'profile' },
        { icon: '\u2699\u{FE0F}', label: '\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438', key: 'settings' },
    ],
};

const DashboardSection: React.FC<DashboardSectionProps> = ({ module, onOpen }) => {
    const [open, setOpen] = useState(false);

    const handleToggle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setOpen(prev => !prev);
    }, []);

    const handleItem = useCallback((e: React.MouseEvent, key: string) => {
        e.stopPropagation();
        onOpen(key);
    }, [onOpen]);

    return (
        <div className="dashboard-section">
            <div className="dashboard-section-header" onClick={handleToggle}>
                <span className="dashboard-section-title">{module}</span>
                <span className={`dashboard-section-arrow ${open ? 'open' : ''}`}>&#x25BC;</span>
            </div>
            <AnimatePresence>
                {open && (
                    <motion.div
                        className="dashboard-dropdown"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        style={{ overflow: 'hidden' }}
                    >
                        {MENU_ITEMS[module].map(item => (
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
        </div>
    );
};

export default DashboardSection;
