FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir --timeout 120 --retries 5 uv
COPY pyproject.toml uv.lock ./
COPY apps/api ./apps/api
COPY worker ./worker
COPY packages/ai_core ./packages/ai_core
RUN uv sync --project apps/api --no-dev
EXPOSE 8001
CMD ["uv", "run", "--project", "apps/api", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--app-dir", "apps/api"]
