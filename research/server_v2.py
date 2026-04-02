import os
import aiohttp
from aiohttp import web
import aiohttp_cors

# Папка для видео
UPLOAD_DIR = 'uploads'
os.makedirs(UPLOAD_DIR, exist_ok=True)

async def handle_get(request):
    """Служит HTML страницу"""
    return web.FileResponse('test-camera-v2.html')

async def handle_post(request):
    """Принимает видео-файлы"""
    reader = await request.multipart()
    field = await reader.next()
    
    filename = field.filename
    size = 0
    filepath = os.path.join(UPLOAD_DIR, filename)
    
    with open(filepath, 'wb') as f:
        while True:
            chunk = await field.read_chunk()
            if not chunk:
                break
            size += len(chunk)
            f.write(chunk)
            
    print(f"✅ Получен файл: {filename} ({size} bytes)")
    return web.Response(text=f"Файл {filename} успешно загружен!")

app = web.Application()

# Настройка CORS (чтобы айфон мог слать запросы к нам)
cors = aiohttp_cors.setup(app, defaults={
    "*": aiohttp_cors.ResourceOptions(
        allow_credentials=True,
        expose_headers="*",
        allow_headers="*",
    )
})

app.router.add_get('/', handle_get)
app.router.add_post('/upload', handle_post)

# Применяем CORS
for route in list(app.router.routes()):
    cors.add(route)

if __name__ == '__main__':
    web.run_app(app, port=3000)
