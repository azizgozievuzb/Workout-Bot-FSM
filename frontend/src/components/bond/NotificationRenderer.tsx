import React, { ReactNode } from 'react';

interface Props {
    type: string;
    payload: Record<string, unknown>;
}

type Renderer = (p: Record<string, unknown>) => ReactNode;

const renderers: Record<string, Renderer> = {
    freeze_consumed: (p) => (
        <>Заморозка сработала — стрик {String(p.streak ?? '?')} дн. сохранён. Осталось: {String(p.new_balance ?? 0)} шт.</>
    ),
    streak_broken: (p) => (
        <>Стрик прерван. Было {String(p.prev_streak ?? 0)} дней — не сдавайся, начни заново!</>
    ),
    freeze_gift: (p) => (
        <>Ответственный подарил тебе {String(p.freeze_count ?? 0)} заморозку(-ок).</>
    ),
    partnership_renewed: (p) => (
        <>Доступ продлён на {String(p.duration_days ?? 0)} дн.</>
    ),
    bonus_pack_credited: (p) => {
        const pocket = p.pocket === 'streak' ? 'стрик-заморозок' : 'подарочных заморозок';
        return <>+{String(p.freeze_count ?? 0)} {pocket} зачислено в кошелёк.</>;
    },
    partnership_deleted: () => (
        <>Ответственный завершил ваше партнёрство.</>
    ),
};

function defaultRenderer(type: string, p: Record<string, unknown>): ReactNode {
    const raw = JSON.stringify(p);
    return <>{type}: {raw.length > 80 ? raw.slice(0, 80) + '…' : raw}</>;
}

export const NotificationRenderer: React.FC<Props> = ({ type, payload }) => {
    const render = renderers[type];
    return (
        <div className="notif-body">
            {render ? render(payload) : defaultRenderer(type, payload)}
        </div>
    );
};
