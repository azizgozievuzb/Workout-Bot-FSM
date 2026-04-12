import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { activatePromo } from '../../api/promo';
import { useAuthStore } from '../../stores/authStore';
import '../../styles/promo-modal.css';

interface PromoCodeModalProps {
    open: boolean;
    onClose: () => void;
    targetRole: 'responsible' | 'player';
    onSuccess: (role: string) => void;
}

const PromoCodeModal: React.FC<PromoCodeModalProps> = ({ open, onClose, targetRole, onSuccess }) => {
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const { addRole, setPlayerCode } = useAuthStore();

    const title = targetRole === 'responsible'
        ? 'Станьте Ответственным — введите промокод'
        : 'Станьте Игроком — введите промокод от другого Ответственного';

    const handleActivate = useCallback(async () => {
        if (!code.trim() || loading) return;
        setLoading(true);
        setError('');

        try {
            const data = await activatePromo(code.trim());
            addRole(targetRole);
            if (data.player_code) setPlayerCode(data.player_code);
            onSuccess(data.role_granted);
            onClose();
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Ошибка активации');
        } finally {
            setLoading(false);
        }
    }, [code, loading, targetRole, addRole, setPlayerCode, onSuccess, onClose]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="promo-modal-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={(e) => { e.stopPropagation(); onClose(); }}
                >
                    <motion.div
                        className="promo-modal-card"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.25 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="promo-modal-title">{title}</h3>

                        <input
                            className="promo-modal-input"
                            type="text"
                            autoComplete="off"
                            autoCapitalize="characters"
                            maxLength={12}
                            value={code}
                            onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
                            placeholder="ПРОМОКОД"
                            disabled={loading}
                        />

                        {error && <div className="promo-modal-error">{error}</div>}

                        <button
                            className="promo-modal-btn"
                            onClick={handleActivate}
                            disabled={!code.trim() || loading}
                        >
                            {loading ? 'Проверяем...' : 'Активировать'}
                        </button>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default PromoCodeModal;
