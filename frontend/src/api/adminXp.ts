import api from './client';

/** S67: экономика XP и уровней. Лестницу и предпросмотр считает БЭК —
 *  фронт ничего не пересчитывает (округление в Python и JS разное). */
export interface LevelPreviewRow {
    level: number;
    cost: number;
    cumulative: number;
    freezes: number;
}

export interface XpSettings {
    xp_mult_main: number;
    xp_mult_light: number;
    level_base: number;
    level_early_step: number;
    level_late_step: number;
    level_boundary: number;
    level_freeze_rewards: Record<string, number>;
    preview: LevelPreviewRow[];
}

export type XpSettingsPatch = Partial<Omit<XpSettings, 'preview'>>;

export async function getXpSettings(): Promise<XpSettings> {
    const { data } = await api.get('/admin/xp-settings');
    return data;
}

export async function updateXpSettings(patch: XpSettingsPatch): Promise<XpSettings> {
    const { data } = await api.patch('/admin/xp-settings', patch);
    return data;
}
