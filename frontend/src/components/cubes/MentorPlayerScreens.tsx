import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPlayerPage } from '../../api/shelf';
import type { PlayerPage } from '../../api/shelf';
import MentorPlayerProfile from './MentorPlayerProfile';
import MentorShelfPage from './MentorShelfPage';
import '../../styles/shelf.css';

/* 8d.1 (П.1a, П.2) — разнесение по кубам, отменяет находку №9.

   Было: одна полуэкранная шторка «всё в одном» (MentorPlayerPage) — и наблюдение,
   и полка, и рекордер. Стало ДВЕ полноэкранные страницы, по одной роли на куб:

   * Action (R)  → страница НАБЛЮДЕНИЯ: досье, дарение, дверь на полку.
   * Market (R)  → ПОЛКА: лоты, слоты, цены, рекордер обещаний, «⏳ Ждут исполнения».

   Этот компонент — общий каркас обеих: держит стек навигации и ОДИН загруженный
   payload на две страницы (пара «профиль ⇄ полка» — один тап в обе стороны,
   без перезагрузки). «← Назад» снимает верх стека; когда стек опустел —
   возвращает в куб, из которого вошли. Поэтому вход и с полки, и с профиля
   ведёт себя одинаково правильно. */

export type MentorPage = 'profile' | 'shelf';

interface Props {
    playerId: string;
    /** Куда вошли: из строки Action — 'profile', из списка Market — 'shelf'. */
    initial: MentorPage;
    onClose: () => void;
}

const MentorPlayerScreens: React.FC<Props> = ({ playerId, initial, onClose }) => {
    const [stack, setStack] = useState<MentorPage[]>([initial]);
    const [page, setPage] = useState<PlayerPage | null>(null);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState('');

    const show = useCallback((m: string) => {
        setToast(m);
        setTimeout(() => setToast(''), 3500);
    }, []);

    const load = useCallback(() => {
        setLoading(true);
        getPlayerPage(playerId)
            .then(setPage)
            .catch(() => show('Не удалось загрузить страницу игрока'))
            .finally(() => setLoading(false));
    }, [playerId, show]);

    useEffect(() => { load(); }, [load]);

    const go = useCallback((next: MentorPage) => setStack((s) => [...s, next]), []);
    const back = useCallback(() => {
        setStack((s) => {
            if (s.length <= 1) { onClose(); return s; }
            return s.slice(0, -1);
        });
    }, [onClose]);

    const current = stack[stack.length - 1];

    const body = (() => {
        if (loading && !page) return <div className="mentor-page-msg">Загрузка…</div>;
        if (!page) {
            return (
                <div className="mentor-page-msg">
                    Не удалось загрузить
                    <button className="cube-btn-sm" style={{ marginTop: 10 }}
                        onClick={(e) => { e.stopPropagation(); load(); }}>Повторить</button>
                </div>
            );
        }
        return current === 'profile' ? (
            <MentorPlayerProfile
                page={page} setPage={setPage} reload={load}
                onBack={back} onOpenShelf={() => go('shelf')} show={show}
            />
        ) : (
            <MentorShelfPage
                page={page} reload={load}
                onBack={back} onOpenProfile={() => go('profile')} show={show}
            />
        );
    })();

    return createPortal(
        <div className="mentor-page">
            {toast && <div className="admin-toast">{toast}</div>}
            {body}
        </div>,
        document.body,
    );
};

export default MentorPlayerScreens;
