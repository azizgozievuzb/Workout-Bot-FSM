"""
Временная заглушка (mock) для FSM-сервиса.

Эмулирует асинхронное взаимодействие с внешним сервисом,
который управляет состоянием XState-машин.
"""
import json

class MockFSMService:
    """
    Эмулирует хранение и обработку состояний FSM.
    В реальном проекте здесь будет клиент для HTTP-сервиса
    или прямое взаимодействие с Redis.
    """
    def __init__(self):
        self._states = {}

    async def get_state(self, user_id: str, machine_id: str):
        """Возвращает текущее состояние машины для пользователя."""
        return self._states.get(f"{user_id}:{machine_id}")

    async def send_event(self, user_id: str, machine_id: str, event: dict):
        """
        Отправляет ивент в машину и возвращает новое состояние.
        Логика переходов здесь сильно упрощена для демонстрации.
        """
        key = f"{user_id}:{machine_id}"
        
        # Начальное состояние
        if key not in self._states:
            self._states[key] = {
                'state': 'languageSelection',
                'context': {}
            }
        
        current_state_data = self._states[key]
        current_state = current_state_data['state']
        context = current_state_data['context']

        # --- Логика переходов для onboardingMachine ---
        if machine_id == 'onboardingMachine':
            if current_state == 'languageSelection' and event['type'] == 'SET_LANG':
                context['lang'] = event['lang']
                current_state = 'roleSelection'
            
            elif current_state == 'roleSelection' and event['type'] == 'SET_ROLE':
                context['role'] = event['role']
                current_state = 'genderSelection'

            elif current_state == 'genderSelection' and event['type'] == 'SET_GENDER':
                context['gender'] = event['gender']
                # Автоматический переход в roleRouting
                current_state = 'roleRouting'

            elif current_state == 'roleRouting' or event.get('type') == 'DEBOUNCE_DUMMY_EVENT':
                # Обработка roleRouting guard'ов
                if context.get('role') == 'player':
                    current_state = 'playerSurvey'
                elif context.get('role') == 'responsible':
                    current_state = 'responsiblePairing'
                else:
                    # Обработка ошибки/неопределенного состояния
                    pass

        self._states[key] = {'state': current_state, 'context': context}
        return self._states[key]

# Создаем синглтон-экземпляр сервиса-заглушки
fsm_service = MockFSMService()
