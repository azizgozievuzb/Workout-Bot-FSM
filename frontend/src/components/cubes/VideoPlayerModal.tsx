import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { getItemVideoUrl } from '../../api/shelf';
import { downloadItemVideo } from '../../utils/videoDownload';
import { hapticImpact } from '../../utils/haptic';

/* 8d.1 (П.6a, находка №18): встроенный плеер видео.

   Раньше видео открывалось внешней вкладкой браузера через tg.openLink — это
   рвало опыт: игрок уходил из Mini App и возвращался «в никуда». Теперь окно
   поверх текущего экрана, «‹ Назад» возвращает ровно туда, откуда пришёл.

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
    /** Обещание до выкупа игрок может только СМОТРЕТЬ — «Скачать» прячем. */
    allowDownload?: boolean;
}

const VideoPlayerModal: React.FC<Props> = ({ itemId, kind, title, onClose, onError, allowDownload = true }) => {
    const theme = useTheme();
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
        /* Класс темы — на корне портала (S66): иначе --tg-theme-* внутри
           приходят от клиента Telegram, а не от нашей темы (урок №17). */
        <div className={`videoplayer-backdrop ${theme}-theme`}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="videoplayer-window" onClick={(e) => e.stopPropagation()}>
                <div className="videoplayer-head">
                    <span className="videoplayer-title">{title}</span>
                </div>

                <div className="videoplayer-stage">
                    {failed ? (
                        <div className="videoplayer-msg">Видео недоступно</div>
                    ) : url ? (
                        /* playsInline + legacy webkit-playsinline: без них iOS
                           уводит ролик в НАТИВНЫЙ полноэкранный плеер со своим
                           «Готово» — и рядом с нашей кнопкой выхода появляется
                           второй, чужой выход (находка смоука 8d.1). Старый
                           атрибут нужен отдельно: React рендерит только
                           playsinline, а часть iOS-webview читает webkit-. */
                        <video className="videoplayer-video" src={url}
                            controls autoPlay playsInline preload="metadata"
                            disablePictureInPicture
                            {...{ 'webkit-playsinline': 'true' }} />
                    ) : (
                        <div className="videoplayer-msg">Загружаем видео…</div>
                    )}
                </div>

                {/* Иерархия П.8c: выход из плеера — ОДИН и крупный, «Скачать»
                    рядом мелкой вторичной. Крестика нет намеренно.
                    Класс СВОЙ, не .cube-btn-sm: модалка живёт в портале body,
                    куда .dark-theme/.light-theme не достают, и тема-зависимая
                    кнопка оставалась без фона — iOS рисовал нативную. */}
                {allowDownload && (
                    <div className="videoplayer-actions">
                        <button className="videoplayer-download" disabled={saving || failed}
                            onClick={(e) => { e.stopPropagation(); save(); }}>
                            {saving ? 'Сохраняем…' : '⬇ Скачать'}
                        </button>
                    </div>
                )}
                <button className="cube-modal-btn cube-modal-btn--primary videoplayer-back"
                    onClick={(e) => { e.stopPropagation(); onClose(); }}>
                    ‹ Назад
                </button>
            </div>
        </div>,
        document.body,
    );
};

export default VideoPlayerModal;
