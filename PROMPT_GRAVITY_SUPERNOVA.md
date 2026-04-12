# PROMPT: Gravity Collapse + Supernova — анимация переключения ролей

> Скопируй этот промпт целиком в Claude Code.

---

## Контекст

Прочитай `CLAUDE.md`, затем `SESSION_STATUS.md` — раздел "СЛЕДУЮЩАЯ ЗАДАЧА".

Сейчас во всех 3 кубах (ActionCube, MarketCube, BondCube) есть простая кнопка переключения ролей Player/Responsible — круглая 36×36px в верхнем левом углу. При тапе просто переключает `useState`. Нужно заменить этот простой toggle на два режима анимации в зависимости от темы.

## Текущее состояние (НЕ читай файлы — верь этому описанию)

### Кнопка toggle (одинаковая во всех 3 кубах):
```tsx
// ActionCube.tsx (строки 25-31), аналогично MarketCube и BondCube
<button
    className={`cube-role-toggle ${dual ? 'dual-active' : ''}`}
    onClick={(e) => { e.stopPropagation(); toggleView(); }}
>
    {view === 'player' ? 'P' : 'R'}
</button>
```

### CSS (cubes.css):
- `.cube-role-toggle` — position: absolute, top: 18px, left: 18px, 36×36px circle, z-index: 30
- `.dark-theme .cube-role-toggle` — чёрная дыра: radial-gradient #111→#333, blue glow
- `.light-theme .cube-role-toggle` — золотая звезда: radial-gradient #FFD700→#FFA500, golden glow
- `.dual-active` — усиленное свечение

### Доступные инструменты:
- **framer-motion v12.38.0** — уже в dependencies, используется в PhotoGate и Backdrop
- Тема определяется CSS-классом на родителе: `.dark-theme` или `.light-theme` (НЕ через React Context)
- Компоненты кубов НЕ получают тему как prop

## Задача

Создай **общий компонент** `RoleTransition` (или хук `useRoleTransition`) который используется всеми 3 кубами. НЕ дублируй логику анимации в каждом кубе.

### Определение темы в компоненте:
Тема задаётся CSS-классом на `.app-container`. Используй `useEffect` + DOM query или `MutationObserver` чтобы определить текущую тему (`dark` или `light`) внутри компонента. Или проще — передавай тему из App.tsx через React Context (создай `ThemeContext`). Выбери лучший подход.

### Режим 1: Gravity Collapse (Dark theme)

Кнопка визуально — маленькая чёрная дыра.

**Тап (dual role = true, обе роли доступны):**
1. Чёрная дыра "активируется" — усиливается свечение, появляется вращающийся аккреционный диск (CSS/canvas)
2. Все UI-элементы текущей роли (children контейнера) гравитационно стягиваются к кнопке — деформируются, уменьшаются, исчезают в точке (framer-motion `animate` с custom trajectory)
3. ~500ms тишины — экран пуст, только пульсирующая дыра
4. "Большой взрыв" — элементы новой роли разлетаются ИЗ точки по своим местам (framer-motion staggered entrance)
5. Дыра возвращается в спокойное состояние

**Тап (dual role = false, вторая роль недоступна):**
- Дыра пульсирует 2 раза интенсивнее обычного, но НЕ поглощает
- Появляется tooltip/toast: "Введите промокод чтобы разблокировать"

**Визуал кнопки:**
- Dual role: цветная дыра (фиолетово-синее свечение по краям)
- Single role: серая дыра (тусклая, минимальное свечение)
- Idle: медленная пульсация (CSS animation, subtle)

### Режим 2: Supernova (Light theme)

Кнопка визуально — маленькая пульсирующая золотая звезда.

**Тап (dual role = true):**
1. Звезда вспыхивает ярким белым светом (scale + brightness)
2. UI-элементы текущей роли разлетаются НАРУЖУ от центра, разбиваясь на световые частицы (framer-motion exit + particle CSS)
3. ~500ms белого свечения — лёгкий золотистый туман на экране
4. Из золотистой пыли "кристаллизуются" элементы новой роли — появляются с blur→sharp эффектом (framer-motion staggered entrance с filter transition)
5. Звезда возвращается к спокойной пульсации

**Тап (dual role = false):**
- Звезда мерцает 2-3 раза ярче обычного, но НЕ вспыхивает
- Tooltip/toast: "Вам нужна пригласительная ссылка"

**Визуал кнопки:**
- Dual role: яркая золотая звезда с активной пульсацией
- Single role: тусклая бледно-жёлтая звезда
- Idle: мягкая пульсация + лучи (CSS animation)

## Технические требования

1. **Один компонент/хук** — переиспользуется в ActionCube, MarketCube, BondCube
2. **framer-motion** для движения элементов (AnimatePresence, motion.div, stagger)
3. **CSS animations** для idle-пульсации кнопки и particle effects
4. **Производительность** — анимация должна быть плавной на мобилках. Используй `transform` и `opacity` (GPU-accelerated). Избегай layout thrashing
5. **Длительность** — полный цикл перехода ~1.5-2 секунды. Не дольше
6. **Accessibility** — `prefers-reduced-motion: reduce` → instant switch без анимации
7. **e.stopPropagation()** — ОБЯЗАТЕЛЬНО сохранить, иначе тап закроет fullscreen
8. **Vanilla CSS** — проект НЕ использует Tailwind. Все стили в `.css` файлах
9. **TypeScript** — строгая типизация, `tsc --noEmit` должен проходить

## Файлы для создания/изменения

### Создать:
- `frontend/src/components/shared/RoleTransition.tsx` — общий компонент анимации
- `frontend/src/styles/role-transition.css` — стили анимации
- `frontend/src/contexts/ThemeContext.tsx` — (если решишь использовать Context для темы)

### Изменить:
- `frontend/src/components/cubes/ActionCube.tsx` — заменить простой toggle на RoleTransition
- `frontend/src/components/cubes/MarketCube.tsx` — то же
- `frontend/src/components/cubes/BondCube.tsx` — то же
- `frontend/src/styles/cubes.css` — обновить стили кнопки
- `frontend/src/App.tsx` — добавить ThemeContext.Provider (если Context)

## Проверка

После реализации:
1. `cd frontend && npx tsc --noEmit` — должен пройти чисто
2. Визуально убедись что анимация корректна (опиши что должно происходить step-by-step)
3. Обнови `SESSION_STATUS.md` — отметь Gravity/Supernova как завершённые

## Чего НЕ делать
- НЕ используй Canvas/WebGL — framer-motion + CSS достаточно
- НЕ читай все файлы проекта — только те что в списке выше
- НЕ объясняй код — просто пиши
- НЕ трогай логику ролей (canPlay, canMonitor, isDualRole) — только визуал переключения
