# 🎨 Design Progress: Workout Bot Backdrop

Этот файл служит контекстом для всех ИИ и разработчиков, работающих над визуальной частью приложения.

## ✅ Текущий Статус (Backdrop 3.0) — STABLE (Woman Edition)
Реализован многослойный фон на **Framer Motion** с интеграцией AI-обработанных лиц и защищенным управлением.

### 📍 Точки контроля (Checkpoint):
- [x] **Character Interchangeability**: Система легко меняет любые лица (тест MEN и WOMAN пройден).
- [x] **Lasso Cut**: Идеальная радиальная вырезка лица без прямоугольников.
- [x] **Double State**: Две ипостаси (Cosmic / Meditating) для каждого лица.
- [x] **Secure Gesture**: Hold 0.5s + Swipe Up — единственный триггер.
- [x] **Speed Optimization**: Переход ускорен с 1.5с до 1.0с (более отзывчиво).

## 🧬 Архитектура
- `src/design/core/AnimationConfig.ts`: Все токены цветов и таймингов.
- `src/design/backdrop/`: Компонент Backdrop (AnimatePresence morphing).
- `src/App.tsx`: Логика "Стального" жеста (Timestamp-based).

## 🚀 Ближайшие задачи:
1. **Avatar Masking**: Проверить наложение "Lumina Ether" на более контрастные фото.
2. **UI Overlay**: Постепенное возвращение элементов управления поверх фона (стеклянные карточки).
3. **Adaptive Dynamics**: Автоматическая подстройка яркости фона под освещенность фото.
