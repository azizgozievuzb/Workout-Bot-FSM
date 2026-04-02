import google.generativeai as genai
import os
import time

# КЛЮЧ ИЗ ВВОДА
API_KEY = "AIzaSyDQaRucbCKxYIoyRFFOUywDckhHyWaEgwM"
genai.configure(api_key=API_KEY)

# ПРОБУЕМ НЕСКОЛЬКО МОДЕЛЕЙ ДЛЯ НАДЕЖНОСТИ
MODEL_NAMES = [
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-3-flash-preview',
    'gemini-2.0-flash-exp'
]

model = None
for m_name in MODEL_NAMES:
    try:
        model = genai.GenerativeModel(m_name)
        # Проверяем на пустом запросе
        test_resp = model.generate_content("ping")
        print(f"✅ Используем модель: {m_name}")
        break
    except Exception:
        continue

if not model:
    print("❌ Не удалось найти работающую модель Gemini.")
    exit(1)

upload_dir = 'uploads'
files = ['test_480p.mp4', 'test_720p.mp4', 'test_1080p.mp4']

uploaded_files = []

for filename in files:
    path = os.path.join(upload_dir, filename)
    if not os.path.exists(path):
        continue

    print(f"📤 Загрузка {filename}...")
    video_file = genai.upload_file(path=path)
    
    while video_file.state.name == "PROCESSING":
        time.sleep(2)
        video_file = genai.get_file(video_file.name)
        
    uploaded_files.append((filename, video_file))

print("\n🧠 АНАЛИЗ ПОШЁЛ...\n")

for name, v_file in uploaded_files:
    print(f"--- РЕЗУЛЬТАТ ДЛЯ {name} ---")
    prompt = "Look at this 10s workout video. Describe the exercise. Is the quality good enough for joint tracking and technical feedback? Please evaluate posture."
    try:
        response = model.generate_content([prompt, v_file])
        print(response.text)
    except Exception as e:
        print(f"❌ Ошибка анализа: {e}")
    print("\n")
    genai.delete_file(v_file.name)

print("🏁 ФИНИШ!")
