import React from 'react';
import { createPortal } from 'react-dom';
import { getMyStats, type PlayerStats } from '../../api/stats';
import { useCached, CACHE_KEYS } from '../../api/cache';
import { useTheme } from '../../contexts/ThemeContext';
import { PlayerIdentityBlock, ReminderBlock } from '../schedule/scheduleBlocks';
import '../../styles/shelf.css';
import '../../styles/profile.css';

/* S64-4/S64-6/S64-8 — «Профиль и настройки» стал настоящим экраном.
   До этого кнопка в BondCube была мёртвой (только stopPropagation), а всё её
   содержимое жило исключительно за скрытым удержанием кубов.

   Состав по ролям (S64-7, S64-8):
   * игрок — имя + звание · время утреннего напоминания · кнопка темы;
   * наставник — имя + кнопка темы (расписания и напоминаний у него нет).
   Тема — настройка приложения, а не игровая механика, поэтому её дом общий
   для ролей: у наставника без роли игрока другого способа сменить тему нет.

   Экран рендерится порталом → красим ТОЛЬКО --tg-theme-* переменными
   (урок №2 PLAYBOOK: тема-классы .dark/.light в порталы не достают). */

interface Props {
    view: 'player' | 'responsible';
    onClose: () => void;
}

/** Имя наставника берём из Telegram — своего профиля бэк ему не отдаёт. */
function telegramFirstName(): string | null {
    const u = (window as any).Telegram?.WebApp?.initDataUnsafe?.user;
    return (u?.first_name as string | undefined) || null;
}

const ProfileScreen: React.FC<Props> = ({ view, onClose }) => {
    const theme = useTheme();
    /* S66 (смоук 30.08: «звание появляется чуть позже»). Экран запрашивал
       getMyStats заново, хотя Action уже держал ровно эти данные. Через общий
       кэш имя и звание есть на первом кадре; свежие приезжают в фоне. */
    const { data: stats } = useCached<PlayerStats>(CACHE_KEYS.myStats, getMyStats);
    const firstName = (view === 'player' ? stats?.first_name : null) ?? telegramFirstName();
    const playerTitle = view === 'player' ? (stats?.player_title ?? null) : null;

    return createPortal(
        /* Тема-класс вешаем на КОРЕНЬ портала (S64, смоук 23.08): портал живёт в
           body, куда .dark-theme/.light-theme с .app-container не достаёт, — из-за
           этого экран оставался серым по --tg-theme-* и не реагировал на свою же
           кнопку темы. Урок №2 PLAYBOOK этим не нарушен: классы не «достают
           снаружи», а объявлены здесь же. */
        <div className={`mentor-page profile-page ${theme}-theme`}>
            <div className="mentor-page-inner">
                <div className="mentor-page-bar">
                    <button className="mentor-back" onClick={(e) => { e.stopPropagation(); onClose(); }}>
                        ← Назад
                    </button>
                    <span className="mentor-page-heading">Профиль и настройки</span>
                </div>

                {/* sched-settings — общая колонка с отступами, та же, что у блоков
                    расписания: экран профиля собран из тех же кусков (S64-7). */}
                <div className="sched-settings">
                    <PlayerIdentityBlock
                        firstName={firstName ?? (view === 'responsible' ? 'Наставник' : null)}
                        playerTitle={playerTitle}
                    />

                    {/* Напоминание — только у игрока: наставнику будить некого. */}
                    {view === 'player' && <ReminderBlock />}

                    {/* S66: строка «Оформление» отсюда убрана (решение юзера 31.08).
                        Переключатель темы переехал к кнопке «Закрыть»
                        (ThemeCycleButton) и стал трёхпозиционным — он виден с
                        любого экрана, а не только из профиля. */}
                </div>
            </div>
        </div>,
        document.body,
    );
};

export default ProfileScreen;
