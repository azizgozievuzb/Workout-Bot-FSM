import { useCallback, useEffect, useRef, useState } from 'react';

/* S66 (жалоба юзера 30.08: «каждый экран грузится долго»).
 *
 * Причина была не в сети, а в том, что кубы РАЗМОНТИРУЮТСЯ при свайпе:
 * AnimatePresence держит только активный модуль, поэтому возврат на экран —
 * это монтирование с нуля и полный перезапрос. Замер S66: один поход сервера
 * в Supabase ≈ 0.5 с, экран Market делает два запроса → ~1.4 с пустоты на
 * КАЖДОМ переключении. Хуже того, Action и Market грузят ОДНО И ТО ЖЕ
 * (`getPlayerShop` + `getSchedule`), а профиль — те же `getMyStats`, что и
 * Action: одни и те же данные ездили по сети по три раза.
 *
 * Здесь простейший кэш «показать старое → тихо обновить» (stale-while-revalidate):
 * если данные уже есть — экран рисуется МГНОВЕННО из памяти, а свежие приезжают
 * в фоне и подменяют их. Библиотеку не тянем: react-query весит больше, чем вся
 * задача, а поведение нужно ровно одно.
 *
 * Кэш живёт в памяти вкладки: перезапуск мини-аппа = чистый старт, устаревших
 * данных «со вчера» не бывает by design.
 */

interface Entry {
    data: unknown;
    at: number;
}

const store = new Map<string, Entry>();
/* Дедупликация: Action и портал профиля монтируются почти одновременно и оба
   зовут getMyStats. Без этого ушло бы два одинаковых запроса. */
const inflight = new Map<string, Promise<unknown>>();

export function readCache<T>(key: string): T | undefined {
    return store.get(key)?.data as T | undefined;
}

export function writeCache<T>(key: string, data: T): void {
    store.set(key, { data, at: Date.now() });
}

/** Сбросить один ключ или весь кэш (без аргумента). */
export function dropCache(key?: string): void {
    if (key === undefined) store.clear();
    else store.delete(key);
}

function fetchShared<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const running = inflight.get(key);
    if (running) return running as Promise<T>;
    const p = fetcher()
        .then((data) => { writeCache(key, data); return data; })
        .finally(() => { inflight.delete(key); });
    inflight.set(key, p);
    return p;
}

/** Дефолт «свежести»: моложе — в фон не ходим вовсе. */
const DEFAULT_STALE_MS = 10_000;

export interface Cached<T> {
    data: T | null;
    /** true только когда показывать НЕЧЕГО (первый заход без кэша). */
    loading: boolean;
    error: boolean;
    /** Принудительный перезапрос — после покупок и прочих мутаций. */
    reload: () => Promise<void>;
    /** Локальное обновление; пишет и в кэш, чтобы соседний экран увидел то же. */
    setData: (update: T | ((prev: T | null) => T | null)) => void;
}

export function useCached<T>(
    key: string,
    fetcher: () => Promise<T>,
    staleMs: number = DEFAULT_STALE_MS,
): Cached<T> {
    const cached = readCache<T>(key);
    const [data, setDataState] = useState<T | null>(cached ?? null);
    const [loading, setLoading] = useState(cached === undefined);
    const [error, setError] = useState(false);

    /* Фетчер меняется на каждом рендере родителя (стрелка в аргументе) — держим
       его в ref, иначе эффект перезапускался бы бесконечно. */
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;

    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
    }, []);

    const run = useCallback(async (showSpinner: boolean) => {
        if (showSpinner) setLoading(true);
        try {
            const fresh = await fetchShared(key, () => fetcherRef.current());
            if (!alive.current) return;
            setDataState(fresh);
            setError(false);
        } catch {
            if (!alive.current) return;
            /* Ошибка при фоновом обновлении не должна стирать то, что уже на
               экране: показываем прежнее, ошибку поднимаем только если пусто. */
            if (readCache<T>(key) === undefined) setError(true);
        } finally {
            if (alive.current) setLoading(false);
        }
    }, [key]);

    useEffect(() => {
        const entry = store.get(key);
        if (entry === undefined) {
            void run(true);
            return;
        }
        setDataState(entry.data as T);
        setLoading(false);
        if (Date.now() - entry.at > staleMs) void run(false);
    }, [key, run, staleMs]);

    const setData = useCallback((update: T | ((prev: T | null) => T | null)) => {
        setDataState((prev) => {
            const next = typeof update === 'function'
                ? (update as (p: T | null) => T | null)(prev)
                : update;
            if (next !== null && next !== undefined) writeCache(key, next);
            return next;
        });
    }, [key]);

    const reload = useCallback(async () => {
        dropCache(key);
        await run(false);
    }, [key, run]);

    return { data, loading, error, reload, setData };
}

/** Прогрев: сходить за данными заранее, если их ещё нет и никто уже не идёт.
 *  Ошибки глушим — это фон, экран о нём знать не должен. */
export function prefetch<T>(key: string, fetcher: () => Promise<T>): void {
    if (store.has(key) || inflight.has(key)) return;
    void fetchShared(key, fetcher).catch(() => {});
}

/* Ключи держим в одном месте: их делят разные экраны, и опечатка в строке
   молча превратилась бы в «кэш не работает». */
export const CACHE_KEYS = {
    schedule: 'schedule',
    playerShop: 'player-shop',
    myStats: 'my-stats',
    feed: 'feed',
} as const;
