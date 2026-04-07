/**
 * DESIGN CORE: Animation & Theme Tokens
 * All visual timing and color shifts happen here.
 */

export const THEME_CONFIG = {
    dark: {
        bg_main: "#000000",
        accents: ["#1a1f3a", "#0f172a", "#1e1b4b"], // Тёмные космические тона
        particles: "rgba(255, 255, 255, 0.4)",
        glow: "rgba(0, 150, 255, 0.3)",
        photo_filter: "saturate(1.2) contrast(1.1)",
    },
    light: {
        bg_main: "#ffffff",
        accents: ["#f8fafc", "#f1f5f9", "#f3f4f6"], // Светлые кремовые тона
        particles: "rgba(0, 0, 0, 0.05)",
        glow: "rgba(255, 45, 133, 0.1)",
        photo_filter: "contrast(0.95) brightness(1.02)",
    }
};

export const ANIM_TIMING = {
    breathing: {
        duration: 10,
        ease: "easeInOut",
        repeat: Infinity,
    },
    parallax_influence: 20, // Сила смещения за пальцем
    transition_dur: 0.8, // Длительность смены темы
};
