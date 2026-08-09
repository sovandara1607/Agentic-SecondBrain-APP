from fastapi import FastAPI

from routers import health, me

app = FastAPI(title="Agentic Second Brain API")
app.include_router(health.router)
app.include_router(me.router)
