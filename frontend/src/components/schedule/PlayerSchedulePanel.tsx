import React from 'react';
import {
    useScheduleState, PlayerIdentityBlock, WeekBlock, FreezeBlock,
    ReminderBlock, MainDaysBlock, LightInfoBlock,
} from './scheduleBlocks';
import './schedule.css';

/* S64-5а — панель скрытой сводки. После переезда блоков в Action (расписание)
   и в профиль (имя, напоминание) она осталась ПОЛНОЙ: сводка = зеркало, а не
   хранилище. Изменился только статус её содержимого — эксклюзива тут больше
   нет, у каждого блока есть явный дом в кубах. Собирается из тех же блоков,
   что и обе явные точки, — копипасты нет (S64-7). */

interface Props {
    lastClosedDay?: string | null;
    freeFreezes?: number;
    paidFreezes?: number;
    /** Эконом-патч №1: имя + звание игрока — шапка его главного экрана. */
    firstName?: string | null;
    playerTitle?: string | null;
    /** Баланс капель — нужен окну подтверждения траты (П.7). */
    dropsBalance?: number;
}

const PlayerSchedulePanel: React.FC<Props> = ({
    lastClosedDay, freeFreezes, paidFreezes, firstName, playerTitle, dropsBalance,
}) => {
    const { sched, setSched } = useScheduleState();

    return (
        /* stopPropagation обязателен: тап по фону сводки её закрывает (S64-2г),
           тап по содержимому панели — нет. */
        <div className="sched-settings" onClick={(e) => e.stopPropagation()}>
            <PlayerIdentityBlock firstName={firstName} playerTitle={playerTitle} />
            <WeekBlock sched={sched} lastClosedDay={lastClosedDay} />
            <FreezeBlock freeFreezes={freeFreezes} paidFreezes={paidFreezes} />
            <ReminderBlock />
            <MainDaysBlock sched={sched} setSched={setSched} dropsBalance={dropsBalance} />
            <LightInfoBlock />
        </div>
    );
};

export default PlayerSchedulePanel;
