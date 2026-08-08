from fastapi import FastAPI

from routers import health

app = FastAPI(title="Agentic Second Brain API")
app.include_router(health.router)
