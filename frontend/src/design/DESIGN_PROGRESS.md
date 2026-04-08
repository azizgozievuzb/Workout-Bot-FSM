# 🎨 Design Progress: Workout Bot Backdrop

Этот файл служит контекстом для всех ИИ и разработчиков, работающих над визуальной частью приложения.

---

## ✅ Restore Point 1 — Backdrop 3.0 (STABLE)
**Tag:** `backdrop-v3-stable` | **Git Hash:** `d1414ec`
**Дата:** 2026-04-07

Реализован многослойный фон на **Framer Motion** с AI-обработанными лицами.

### Что было сделано:
- [x] **Character Interchangeability**: Система легко меняет любые лица (MEN / WOMAN).
- [x] **Lasso Cut**: Радиальная вырезка лица без прямоугольников.
- [x] **Double State**: Две ипостаси (Cosmic / Meditating) для каждого лица.
- [x] **Secure Gesture**: Hold 0.5s + Swipe Up — единственный триггер смены темы.
- [x] **Speed Optimization**: Переход ускорен с 1.5с до 1.0с.

### Откат:
```bash
git reset --hard d1414ec
```

---

## ✅ Restore Point 2 — Backdrop 5.1 "Warp Flight + Ghost Face" (STABLE)
**Tag:** `backdrop-v5-stable`
**Дата:** 2026-04-08

Canvas-based полёт сквозь космос с лицом-призраком на заднем фоне.

### Что было сделано:
- [x] **Starfield Engine**: Canvas 3D, 1200 звёзд, реалистичные эллипсоиды, без следов.
- [x] **Arc Turns**: Дрейф vanishing point — плавные повороты по дуге (10с фазы: право→прямо→лево→прямо).
- [x] **Light Mode — Gold Cosmos**: Белый фон, золотые/amber звёзды (та же 3D механика).
- [x] **Ghost Face**: Лицо на весь экран (115%), opacity 0.15, z-index 0 (ЗА canvas).
- [x] **Blend Modes**: `screen` (dark) / `multiply` (light) — частицы летят поверх лица.
- [x] **Radial Mask**: Лицо видно до 80%, угасает в последних 20% краёв.
- [x] **MCP Shell**: Cowork подключён к терминалу (mcp-shell-server).

### Архитектура слоёв:
```
z: -10  backdrop-stage (фон)
z:  0   .face-fullscreen (лицо-призрак, 115%, opacity 0.15)
z:  1   canvas (Starfield/CloudField, mix-blend-mode)
z: 10   .ui-vignette
```

### Ключевые файлы:
- `src/design/backdrop/Backdrop.tsx`
- `src/design/backdrop/Starfield.tsx`
- `src/design/backdrop/CloudField.tsx`
- `src/design/backdrop/Backdrop.css`

### Откат:
```bash
git reset --hard backdrop-v5-stable
```

---

## ✅ Restore Point 3 — Design Progress 3 "Glass Cubes & Ellipsoids" (STABLE)
**Tag:** `design-progress-3`
**Дата:** 2026-04-08

Революционный 3D-движок рендеринга на Canvas, реализующий тяжелые плавающие объекты с внутренним пламенем.

### Что было сделано:
- [x] **Dark Mode (Volumetric Cubes)**: Киберпанк-кубы с физическим отскоком. Прозрачное стекло, толстые рамки, внутри пульсирует сгусток энергии.
- [x] **Light Mode (Glossy Ellipsoids)**: Кубы превращаются в эллипсоиды (капсулы из густого янтаря). Экстремальный френель, мощные блики обода толстого стекла.
- [x] **Monolithic typography**: Объемный 3D-текст жестко интегрирован вглубь стекла в обоих режимах. В светлой теме жестко привязан к матрице эллипсоида для монолитной читабельности.
- [x] **Physics AI**: Автоматический дрейф объектов. Ядра внутри объектов перемещаются по собственным законам со своими границами-отскоками (адаптируется под тему).

### Архитектура:
- `GlassCubes.tsx` -> Математический 2D/3D Canvas Render (Project, RotatePoint, Affine Transform)

### Откат:
```bash
git reset --hard design-progress-3
```

---

## 🚀 Следующие задачи:
1. **Face Upgrade**: Заменить тестовые лица на финальные AI-обработанные.
2. **UI Overlay**: Glassmorphic карточки поверх backdrop.
3. **Adaptive Glow**: Цвета фона адаптируются под доминантные цвета аватара.
4. **FSM Integration**: Интеграция `backdrop` ↔ `workoutSessionMachine`.
