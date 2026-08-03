import { getItemVideoUrl } from '../api/shelf';

/* 8d.1 (П.6b, Д5): «⬇ Скачать» — сохранение файла на устройство.
   Запрет внешней вкладки (находка №18) касается ПРОСМОТРА: смотреть теперь можно
   только во встроенном плеере. Скачивание внешним механизмом разрешено — в
   webview иначе файл на устройство не положить. */

/** Supabase отдаёт Content-Disposition: attachment по параметру download. */
function withAttachment(url: string, fileName: string): string {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}download=${encodeURIComponent(fileName)}`;
}

function extFromUrl(url: string): string {
    const clean = url.split('?')[0];
    const m = clean.match(/\.(webm|mp4|mov)$/i);
    return m ? m[1].toLowerCase() : 'webm';
}

/** Транслитерация: имя файла уходит в заголовок и в файловую систему. */
function safeName(title: string, ext: string): string {
    const base = (title || 'video')
        .trim()
        .replace(/[^\p{L}\p{N}\s._-]/gu, '')
        .replace(/\s+/g, '_')
        .slice(0, 48) || 'video';
    return `${base}.${ext}`;
}

/**
 * Скачивание видео лота. Возвращает false, если клиент не дал сохранить файл —
 * вызывающий показывает тост.
 */
export async function downloadItemVideo(
    itemId: string,
    kind: 'promise' | 'report',
    title: string,
): Promise<boolean> {
    const signed = await getItemVideoUrl(itemId, kind);
    if (!signed) return false;
    const url = withAttachment(signed, safeName(title, extFromUrl(signed)));

    const tg = (window as any).Telegram?.WebApp;
    // Bot API 8.0+: нативный диалог сохранения прямо в Telegram.
    if (typeof tg?.downloadFile === 'function') {
        try {
            tg.downloadFile({ url, file_name: safeName(title, extFromUrl(signed)) });
            return true;
        } catch { /* старый клиент — падаем в ссылку ниже */ }
    }
    if (typeof tg?.openLink === 'function') {
        try { tg.openLink(url); return true; } catch { /* ниже */ }
    }
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
}
