FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# cache bust: 2026-04-09

COPY backend/ ./backend/

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# PORT задаётся Railway автоматически
EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
