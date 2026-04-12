# PROMPT: UX-фиксы — жесты, dashboard редизайн, кнопка роли

> Скопируй этот промпт целиком в Claude Code.

---

## Контекст

Прочитай `CLAUDE.md`, затем `SESSION_STATUS.md`. Сейчас 4 проблемы, которые нужно исправить за одну сессию.

---

## Задача 1: Выход из fullscreen куба — ТОЛЬКО long press 3 сек

**Проблема:** В `App.tsx`, функция `handleGestureUp` (≈строка 105-109) при `layout === 'fullscreen'` — любой pointer-up возвращает в chaos. Это значит: тап по пустому месту, тап по кнопке роли — всё сворачивает куб.

**Текущий код (удалить):**
```typescript
} else if (cur === 'fullscreen') {
    setLayout('chaos');
    setActiveModule(null);
}
```

**Решение:** Выход из fullscreen ТОЛЬКО через long press 3 секунды (константа `HOLD_DASHBOARD = 3000` уже есть). Изменить логику:

1. В `handleGestureUp` — **убрать** блок `cur === 'fullscreen'` который сворачивает по тапу
2. В `handleGestureDown` (≈строка 70-80) — в `setTimeout` добавить условие: если `cur === 'fullscreen'` → `setLayout('chaos')` (как уже работает для dashboard→chaos)

По сути — long press 3 сек теперь универсальный переключатель: chaos→dashboard, dashboard→chaos, fullscreen→chaos.

**e.stopPropagation():** Все интерактивные элементы внутри fullscreen (кнопки, ссылки) уже используют `e.stopPropagation()` — это НЕ трогать.

---

## Задача 2: Кнопка роли — размер, позиция, визуал

### 2a. Размер и позиция
Кнопка роли (`.cube-role-toggle` в `role-transition.css`) сейчас 36×36px, top: 18px, left: 18px. Нужно:
- Увеличить до **48×48px**
- Поднять: `top: 12px`
- Убедиться что кнопка **НЕ перекрывает** никакие другие элементы куба. Для этого добавить `padding-top` контенту куба (~70px), чтобы контент начинался ниже кнопки
- Шрифт буквы (P/R) — увеличить до 22px

### 2b. Dark theme — реалистичная чёрная дыра (фото Event Horizon Telescope)
Визуал: чёрный диск в центре, вокруг — яркое оранжево-жёлтое кольцо аккреционного диска. Лучи света огибают сферу (гравитационное линзирование).

**CSS-реализация (radial + conic gradient + box-shadow):**
```css
.dark-theme .role-toggle-btn {
    /* Чёрный диск */
    background: radial-gradient(circle at 50% 50%,
        #000000 0%,
        #000000 35%,
        #1a0800 40%,
        #ff6b00 48%,
        #ffaa00 52%,
        #ff8c00 56%,
        #cc4400 62%,
        #440000 70%,
        transparent 75%
    );
    /* Ассиметричное свечение (верхняя часть ярче — как на фото EHT) */
    box-shadow:
        0 -3px 15px rgba(255, 160, 0, 0.6),
        0 3px 8px rgba(255, 100, 0, 0.2),
        0 0 25px rgba(255, 120, 0, 0.3),
        inset 0 0 8px rgba(0, 0, 0, 0.9);
    border: 1px solid rgba(255, 140, 0, 0.3);
}
```
- Dual-active: усиленное свечение, кольцо ярче
- Single role: кольцо тусклое, серо-оранжевое
- Idle анимация: медленное вращение свечения (через `@keyframes` + `filter: hue-rotate`)
- Буква P/R — белая с лёгким glow, чтобы читалась поверх чёрного диска

### 2c. Light theme — Кассиопея A (яркий остаток сверхновой)
Визуал: яркий, многоцветный шар — зелёные, красные, синие, фиолетовые нити газа, расходящиеся от центра. Как [фото Cassiopeia A от Hubble](https://science.nasa.gov/asset/hubble/cassiopeia-a-colorful-shredded-remains-of-old-supernova/).

**CSS-реализация (multiple radial gradients + animation):**
```css
.light-theme .role-toggle-btn {
    background:
        radial-gradient(circle at 45% 40%, rgba(0, 255, 150, 0.7) 0%, transparent 30%),
        radial-gradient(circle at 60% 55%, rgba(255, 50, 80, 0.6) 0%, transparent 25%),
        radial-gradient(circle at 40% 60%, rgba(80, 80, 255, 0.6) 0%, transparent 28%),
        radial-gradient(circle at 55% 35%, rgba(255, 200, 50, 0.5) 0%, transparent 22%),
        radial-gradient(circle at 50% 50%, #fff 0%, #ffeedd 20%, #ffccaa 40%, #ee8866 60%, transparent 70%);
    box-shadow:
        0 0 12px rgba(255, 100, 50, 0.5),
        0 0 25px rgba(255, 180, 80, 0.3),
        0 0 4px rgba(255, 255, 255, 0.8);
    border: 1px solid rgba(255, 200, 150, 0.4);
}
```
- Dual-active: ярче, насыщеннее, лучи длиннее
- Single role: бледная, выцветшая
- Idle анимация: мягкая пульсация яркости + лёгкое мерцание цветных пятен
- Буква P/R — тёмная с лёгкой тенью для читаемости

---

## Задача 3: Dashboard — один блок с тремя секциями + dropdown меню

### 3a. Убрать крестик
В `App.tsx` (≈строка 175) удалить:
```tsx
<button className="overlay-close" onClick={handleClose}>✕</button>
```
Выход из dashboard — ТОЛЬКО long press 3 сек (уже работает через `handleGestureDown`).

### 3b. Один блок вместо трёх карточек
Сейчас: 3 отдельных `.dashboard-card` с gap между ними.
Нужно: **один контейнер** `.dashboard-panel` с тремя секциями внутри, разделёнными тонкой линией (divider).

```tsx
{layoutMode === 'dashboard' && (
    <div className="overlay-dashboard"
        onPointerDown={handleGestureDown}
        onPointerUp={handleGestureUp}
    >
        <div className="dashboard-panel">
            {(['Action', 'Market', 'Bond'] as ModuleName[]).map((mod, i, arr) => (
                <React.Fragment key={mod}>
                    <DashboardSection module={mod} onOpen={(sub) => {
                        setLayout('fullscreen');
                        setActiveModule(mod);
                        // sub — выбранный пункт подменю (опционально)
                    }} />
                    {i < arr.length - 1 && <div className="dashboard-divider" />}
                </React.Fragment>
            ))}
        </div>
    </div>
)}
```

### 3c. DashboardSection — компонент с dropdown
Создать `frontend/src/components/shared/DashboardSection.tsx`:

Каждая секция содержит:
- Название модуля (Action / Market / Bond)
- Кнопку со стрелочкой (▼) — тап раскрывает dropdown с подпунктами модуля
- Dropdown — выезжает сверху вниз (framer-motion AnimatePresence)

**Подпункты (контекстное меню):**

**Action:**
- 🏋️ Начать тренировку
- 📊 Статистика дня
- 🔥 Мой стрик
- 😴 День отдыха

**Market:**
- 🛒 Магазин
- ⭐ Мой баланс
- 🎁 Лутбоксы

**Bond:**
- 📰 Лента событий
- 🏆 Достижения
- 👤 Профиль
- ⚙️ Настройки

При выборе пункта — открывается fullscreen соответствующего куба.

### 3d. CSS для dashboard

```css
.dashboard-panel {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(20px);
    border-radius: 24px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 400px;
    margin: auto;
}

.dashboard-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
    margin: 0 16px;
}

.dashboard-section { padding: 16px 20px; }

.dashboard-section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
}

.dashboard-section-arrow {
    transition: transform 0.2s ease;
}
.dashboard-section-arrow.open {
    transform: rotate(180deg);
}

.dashboard-dropdown-item {
    padding: 12px 16px;
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.15s;
}
.dashboard-dropdown-item:active {
    background: rgba(255, 255, 255, 0.1);
}
```

---

## Задача 4: Gesture handler cleanup

Убедись что после всех изменений жесты работают так:

| Контекст | Тап | Long press 3 сек | Hold + swipe up |
|---|---|---|---|
| Chaos | Тап по кубу → fullscreen | → Dashboard | Смена темы |
| Fullscreen | Ничего (взаимодействие с UI куба) | → Chaos | Смена темы |
| Dashboard | Ничего (dropdown меню) | → Chaos | Смена темы |

---

## Файлы для создания/изменения

### Создать:
- `frontend/src/components/shared/DashboardSection.tsx`
- `frontend/src/styles/dashboard.css`

### Изменить:
- `frontend/src/App.tsx` — жесты + dashboard рендеринг
- `frontend/src/App.css` — убрать старые dashboard-card стили
- `frontend/src/styles/role-transition.css` — новый визуал кнопки (чёрная дыра + Кассиопея A)
- `frontend/src/components/shared/RoleTransition.tsx` — увеличить размер кнопки

## Проверка

1. `cd frontend && npx tsc --noEmit` — чисто
2. Обнови `SESSION_STATUS.md`

## Чего НЕ делать
- НЕ трогай логику ролей, FSM, API
- НЕ читай файлы кроме перечисленных
- НЕ объясняй код
