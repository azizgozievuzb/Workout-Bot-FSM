"""
Обработчики для машины состояний 'onboardingMachine'.

Файл реализует логику взаимодействия с пользователем на каждом шаге
процесса онбординга, строго следуя FSM-блюпринту.
"""
from aiogram import Router, F, types
from aiogram.fsm.context import FSMContext
from aiogram.filters import StateFilter

# TODO: Заменить на настоящий FSM-сервис
from ..services.fsm_mock import fsm_service
from ..keyboards.onboarding_keyboards import get_language_keyboard, get_role_keyboard, get_gender_keyboard

onboarding_router = Router(name=__name__)


# ==========================================================================
# 0. ВХОД В МАШИНУ (Предполагается, что другой хэндлер, например /start,
#    инициирует машину и передает управление сюда)
# ==========================================================================

async def render_onboarding_step(message: types.Message, state: FSMContext):
    """
    Центральная функция-диспетчер.
    Определяет текущее состояние FSM и вызывает соответствующую
    функцию для отрисовки UI (отправки сообщения пользователю).
    """
    current_state_str = await state.get_state()
    
    state_renderers = {
        "languageSelection": render_language_selection,
        "roleSelection": render_role_selection,
        "genderSelection": render_gender_selection,
        # ... другие состояния будут добавлены здесь
    }
    
    renderer = state_renderers.get(current_state_str)
    
    if renderer:
        await renderer(message, state)
    else:
        # TODO: Добавить логирование для необработанных состояний
        pass


# ==========================================================================
# 1. STATE: languageSelection
# ==========================================================================

async def render_language_selection(message: types.Message, state: FSMContext):
    """Отправляет сообщение для выбора языка."""
    await message.answer("Выберите язык / Tilni tanlang / Choose your language:",
                         reply_markup=get_language_keyboard())

@onboarding_router.callback_query(StateFilter("languageSelection"), F.data.startswith("lang_"))
async def process_language_selection(callback: types.CallbackQuery, state: FSMContext):
    """
    Обрабатывает выбор языка, отправляет ивент 'SET_LANG' в FSM
    и переходит к следующему шагу.
    """
    lang = callback.data.split("_")[1]
    user_id = str(callback.from_user.id)
    
    # 1. Отправляем ивент в FSM
    next_state_data = await fsm_service.send_event(
        user_id, 'onboardingMachine', {'type': 'SET_LANG', 'lang': lang}
    )
    
    # 2. Обновляем состояние в Aiogram
    await state.set_state(next_state_data['state'])
    
    # 3. Вызываем диспетчер для отрисовки нового состояния
    await render_onboarding_step(callback.message, state)
    await callback.answer()


# ==========================================================================
# 2. STATE: roleSelection
# ==========================================================================

async def render_role_selection(message: types.Message, state: FSMContext):
    """Отправляет сообщение для выбора роли."""
    await message.edit_text("Кто вы?", reply_markup=get_role_keyboard())

@onboarding_router.callback_query(StateFilter("roleSelection"), F.data.startswith("role_"))
async def process_role_selection(callback: types.CallbackQuery, state: FSMContext):
    """
    Обрабатывает выбор роли, отправляет ивент 'SET_ROLE' в FSM
    и переходит к следующему шагу.
    """
    role = callback.data.split("_")[1]
    user_id = str(callback.from_user.id)

    next_state_data = await fsm_service.send_event(
        user_id, 'onboardingMachine', {'type': 'SET_ROLE', 'role': role}
    )
    await state.set_state(next_state_data['state'])
    await render_onboarding_step(callback.message, state)
    await callback.answer()


# ==========================================================================
# 3. STATE: genderSelection
# ==========================================================================

async def render_gender_selection(message: types.Message, state: FSMContext):
    """Отправляет сообщение для выбора пола."""
    await message.edit_text("Ваш пол?", reply_markup=get_gender_keyboard())

@onboarding_router.callback_query(StateFilter("genderSelection"), F.data.startswith("gender_"))
async def process_gender_selection(callback: types.CallbackQuery, state: FSMContext):
    """
    Обрабатывает выбор пола, отправляет ивент 'SET_GENDER' в FSM.
    FSM автоматически перейдет в 'roleRouting', который мы обработаем.
    """
    gender = callback.data.split("_")[1]
    user_id = str(callback.from_user.id)

    next_state_data = await fsm_service.send_event(
        user_id, 'onboardingMachine', {'type': 'SET_GENDER', 'gender': gender}
    )
    
    # Важно: FSM автоматически переходит из genderSelection -> roleRouting
    # next_state_data['state'] будет 'roleRouting'
    await state.set_state(next_state_data['state'])
    
    # Обрабатываем автоматический переход
    await process_role_routing(callback.message, state)
    await callback.answer()


# ==========================================================================
# 4. STATE: roleRouting (auto-transition)
# ==========================================================================

async def process_role_routing(message: types.Message, state: FSMContext):
    """
    Обрабатывает автоматический переход 'roleRouting'.
    
    Этот хэндлер не вызывается напрямую пользователем. Он смотрит на 
    контекст FSM, который был обновлен на предыдущем шаге, и решает,
    куда двигаться дальше.
    """
    user_id = str(message.chat.id) # или другой способ получить ID
    
    # Получаем актуальный контекст из FSM-сервиса
    current_fsm_data = await fsm_service.get_state(user_id, 'onboardingMachine')
    
    # На основе этого контекста FSM уже должен был совершить переход.
    # Мы просто запрашиваем у него финальное состояние после роутинга.
    final_state_data = await fsm_service.send_event(user_id, 'onboardingMachine', {'type': 'DEBOUNCE_DUMMY_EVENT'})
    
    await state.set_state(final_state_data['state'])
    
    # Снова вызываем главный диспетчер, который теперь отрисует
    # либо 'playerSurvey', либо 'responsiblePairing'.
    await render_onboarding_step(message, state)

