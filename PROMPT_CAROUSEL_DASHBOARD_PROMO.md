# PROMPT: Свайп-карусель в fullscreen + Dashboard fullscreen + Промокод-модалка

> Скопируй этот промпт целиком в Claude Code.

---

## Контекст

Прочитай `CLAUDE.md`, затем `SESSION_STATUS.md`. Три задачи в этой сессии.

---

## Задача 1: Свайп-карусель между кубами в fullscreen

**Сейчас:** Тап по кубу в chaos → открывается fullscreen с одним кубом (ActionCube / MarketCube / BondCube). Нет способа переключиться на другой куб без выхода.

**Нужно:** В fullscreen режиме — горизонтальный свайп влево/вправо переключает между кубами как карусель.

### Порядок кубов: Action → Market → Bond → Action (зацикленная)

### Реализация

В `App.tsx` fullscreen overlay (≈строки 154-163) сейчас:
```tsx
{layoutMode === 'fullscreen' && activeModule && (
    <div className="overlay-fullscreen" onPointerDown={handleGestureDown} onPointerUp={handleGestureUp}>
        <div className="overlay-title">{activeModule}</div>
        <div className="overlay-body">
            {activeModule === 'Action' && <ActionCube />}
            {activeModule === 'Market' && <MarketCube />}
            {activeModule === 'Bond' && <BondCube />}
        </div>
    </div>
)}
```

Заменить на карусель с framer-motion. Вот подход:

1. **Состояние направления:** `swipeDirection` для AnimatePresence — определяет анимацию входа/выхода (влево или вправо)

2. **Обработка свайпа:** Добавить в `handleGestureUp` (или отдельный handler на overlay-fullscreen):
   - Если `layoutMode === 'fullscreen'`
   - Горизонтальный delta > 50px
   - Elapsed < 500ms (быстрый свайп)
   - Свайп влево → следующий куб, свайп вправо → предыдущий

3. **Массив модулей:**
```typescript
const MODULES: ModuleName[] = ['Action', 'Market', 'Bond'];
const nextModule = (cur: ModuleName, dir: 1 | -1): ModuleName => {
    const idx = MODULES.indexOf(cur);
    return MODULES[(idx + dir + MODULES.length) % MODULES.length];
};
```

4. **Анимация перехода** (framer-motion):
```tsx
<AnimatePresence mode="wait" custom={swipeDir}>
    <motion.div
        key={activeModule}
        custom={swipeDir}
        initial={{ x: swipeDir * 300, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: -swipeDir * 300, opacity: 0 }}
        transition={{ duration: 0.25, ease: 'easeInOut' }}
        className="overlay-body"
    >
        {activeModule === 'Action' && <ActionCube />}
        {activeModule === 'Market' && <MarketCube />}
        {activeModule === 'Bond' && <BondCube />}
    </motion.div>
</AnimatePresence>
```

5. **Индикатор:** Три точки внизу экрана — показывают какой куб активен (как в мобильных onboarding-экранах).

```tsx
<div className="carousel-dots">
    {MODULES.map(m => (
        <span key={m} className={`carousel-dot ${m === activeModule ? 'active' : ''}`} />
    ))}
</div>
```

6. **ВАЖНО:** Горизонтальный свайп НЕ должен конфликтовать с вертикальным (hold + swipe up = тема). Различай по направлению: если `|deltaX| > |deltaY|` → горизонтальный свайп, иначе → вертикальный.

7. **ВАЖНО:** Свайп карусели должен работать поверх контента куба. Используй `pointerStartX` (добавить по аналогии с `pointerStartY` который уже есть) в `handleGestureDown` и проверяй delta в `handleGestureUp`.

---

## Задача 2: Dashboard на весь экран

**Сейчас:** Dashboard — `.dashboard-panel` с `max-width: 400px; margin: auto` внутри `overlay-dashboard`. Выглядит как маленькая карточка по центру.

**Нужно:** Dashboard занимает **весь экран** целиком. Панель растягивается на всю высоту и ширину.

### Изменения в CSS (`dashboard.css`):

```css
.dashboard-panel {
    /* УБРАТЬ max-width: 400px и margin: auto */
    width: 100%;
    height: 100%;
    border-radius: 0;  /* Убрать скругления — весь экран */
    display: flex;
    flex-direction: column;
}

.dashboard-section {
    flex: 1;  /* Каждая секция занимает равную часть */
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
```

### Изменения в CSS (`App.css`):

```css
.overlay-dashboard {
    padding: 0;  /* Убрать padding — весь экран */
    align-items: stretch;
    justify-content: stretch;
}
```

### Содержимое секций

Каждая секция должна показывать максимум информации напрямую (без dropdown) — сколько вмещается. То, что НЕ вмещается → dropdown-кнопка "Ещё ▼".

**Action секция (видно сразу):**
- Название "Action" + иконка
- Кнопка "🏋️ Начать тренировку" — крупная, акцентная
- Стрик: "🔥 5 дней" (если есть)
- Dropdown "Ещё ▼": Статистика дня, День отдыха

**Market секция (видно сразу):**
- Название "Market" + иконка
- Баланс: "⭐ 150"
- Кнопка "🛒 Магазин" — крупная
- Dropdown "Ещё ▼": Лутбоксы

**Bond секция (видно сразу):**
- Название "Bond" + иконка
- Непрочитанные: "📰 3 новых"
- Кнопка "👤 Профиль"
- Dropdown "Ещё ▼": Достижения, Настройки

Обнови `DashboardSection.tsx` — разделить `MENU_ITEMS` на `PRIMARY_ITEMS` (видны сразу) и `MORE_ITEMS` (в dropdown). Dropdown открывается по тапу на "Ещё ▼".

---

## Задача 3: Модалка промокода при тапе на кнопку роли (single role)

**Сейчас:** В `RoleTransition.tsx`, когда single-role пользователь тапает по кнопке, показывается toast на 2 секунды с текстом `lockedMessage`. Для игрока: "Введите промокод чтобы стать Ответственным". Toast — просто текст, некуда ввести промокод.

**Нужно:** Вместо toast → модальное окно с полем ввода промокода.

### Создать компонент `PromoCodeModal.tsx` в `frontend/src/components/shared/`:

```tsx
interface PromoCodeModalProps {
    open: boolean;
    onClose: () => void;
    role: 'player' | 'responsible'; // Какую роль пытается разблокировать
}
```

**UI:**
- Оверлей (полупрозрачный фон)
- Карточка по центру (glassmorphism):
  - Заголовок: "Разблокировать роль Ответственного" (или "...роль Игрока")
  - Подсказка: "Введите промокод от вашего партнёра"
  - Текстовое поле `<input>` (стилизованное)
  - Кнопка "Активировать" (при пустом поле — disabled)
  - Кнопка "Отмена" (текстовая)
- При сабмите пока ничего не делаем (API ещё нет) — просто `console.log('promo:', code)` и закрываем модалку
- `e.stopPropagation()` на всей модалке!

### Изменить `RoleTransition.tsx`:

Заменить блок denied (≈строки 63-72) где `setToast(true)`:

```tsx
// Вместо toast — открыть модалку
if (!dual) {
    setDenied(true);
    setShowPromo(true);  // Новый useState
    timerRef.current = setTimeout(() => setDenied(false), 600);
    return;
}
```

Убрать toast-рендеринг. Вместо него:

```tsx
<PromoCodeModal
    open={showPromo}
    onClose={() => setShowPromo(false)}
    role={currentView === 'player' ? 'responsible' : 'player'}
/>
```

### CSS (`frontend/src/styles/promo-modal.css`):

Glassmorphism стиль, тёмная/светлая тема через `.dark-theme` / `.light-theme` CSS селекторы. Поле ввода — крупное, 48px высота, border-radius 12px. Кнопка "Активировать" — accent цвет.

---

## Файлы для создания/изменения

### Создать:
- `frontend/src/components/shared/PromoCodeModal.tsx`
- `frontend/src/styles/promo-modal.css`

### Изменить:
- `frontend/src/App.tsx` — свайп-карусель + gesture handler + carousel dots
- `frontend/src/App.css` — overlay-dashboard padding, carousel-dots стили
- `frontend/src/styles/dashboard.css` — fullscreen dashboard
- `frontend/src/components/shared/DashboardSection.tsx` — primary/more items split
- `frontend/src/components/shared/RoleTransition.tsx` — модалка вместо toast

## Проверка

1. `cd frontend && npx tsc --noEmit` — чисто
2. Обнови `SESSION_STATUS.md`

## Чего НЕ делать
- НЕ трогай логику ролей, FSM, backend API
- НЕ читай файлы кроме перечисленных
- НЕ объясняй код
- НЕ дублируй компоненты — переиспользуй
