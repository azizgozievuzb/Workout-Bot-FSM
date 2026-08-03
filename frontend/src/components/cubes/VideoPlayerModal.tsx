import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getItemVideoUrl } from '../../api/shelf';
import { downloadItemVideo } from '../../utils/videoDownload';
import { hapticImpact } from '../../utils/haptic';

/* 8d.1 (П.6a, находка №18): встроенный плеер видео.

   Раньше видео открывалось внешней вкладкой браузера через tg.openLink — это
   рвало опыт: игрок уходил из Mini App и возвращался «в никуда». Теперь окно
   поверх текущего экрана, крестик возвращает ровно туда, откуда пришёл.

   Один компонент на все три места: полка наставника, «Мои покупки» игрока,
   просмотр отчёта наставником. Подписанная ссылка грузится ЛЕНИВО — по тапу,
   а не пачкой на весь список. */

interface Props {
    itemId: string;
    kind: 'promise' | 'report';
    /** Заголовок окна — что именно смотрим (кнопка говорит только «Смотреть»). */
    title: string;
    onClose: () => void;
    /** Тост родителя: единый слой сообщений на экране. */
    onError?: (message: string) => void;
}

const VideoPlayerModal: React.FC<Props> = ({ itemId, kind, title, onClose, onError }) => {
    const [url, setUrl] = useState('');
    const [failed, setFailed] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let alive = true;
        getItemVideoUrl(itemId, kind)
            .then((u) => { if (alive) setUrl(u); })
            .catch(() => { if (alive) setFailed(true); });
        return () => { alive = false; };
    }, [itemId, kind]);

    const save = useCallback(async () => {
        if (saving) return;
        setSaving(true);
        hapticImpact('light');
        try {
            const ok = await downloadItemVideo(itemId, kind, title);
            if (!ok) onError?.('Не удалось скачать видео');
        } catch {
            onError?.('Не удалось скачать видео');
        } finally {
            setSaving(false);
        }
    }, [saving, itemId, kind, title, onError]);

    return createPortal(
        <div className="videoplayer-backdrop"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="videoplayer-window" onClick={(e) => e.stopPropagation()}>
                <div className="videoplayer-head">
                    <span className="videoplayer-title">{title}</span>
                    <button className="videoplayer-close" aria-label="Закрыть"
                        onClick={(e) => { e.stopPropagation(); onClose(); }}>✕</button>
                </div>

                <div className="videoplayer-stage">
                    {failed ? (
                        <div className="videoplayer-msg">Видео недоступно</div>
                    ) : url ? (
                        /* controls + playsInline обязательны: без playsInline iOS
                           уводит ролик в нативный полноэкранный плеер и модалка
                           теряет контекст, ради которого её и делали. */
                        <video className="videoplayer-video" src={url}
                            controls autoPlay playsInline preload="metadata" />
                    ) : (
                        <div className="videoplayer-msg">Загружаем видео…</div>
                    )}
                </div>

                <div className="videoplayer-actions">
                    <button className="cube-modal-btn cube-modal-btn--ghost" disabled={saving || failed}
                        onClick={(e) => { e.stopPropagation(); save(); }}>
                        {saving ? 'Сохраняем…' : '⬇ Скачать'}
                    </button>
                    <button className="cube-modal-btn cube-modal-btn--primary"
                        onClick={(e) => { e.stopPropagation(); onClose(); }}>
                        Готово
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
};

export default VideoPlayerModal;
