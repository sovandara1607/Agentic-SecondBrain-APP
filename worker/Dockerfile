FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir --timeout 120 --retries 5 uv
COPY pyproject.toml uv.lock ./
COPY worker ./worker
COPY apps/api ./apps/api
COPY packages/ai_core ./packages/ai_core
RUN uv sync --project worker --no-dev
CMD ["uv", "run", "--project", "worker", "--", "python", "worker/main.py"]
