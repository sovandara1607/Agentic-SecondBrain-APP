from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import get_settings
from routers import agents, captures, export, health, me, search

app = FastAPI(title="Agentic Second Brain API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health.router)
app.include_router(me.router)
app.include_router(agents.router)
app.include_router(search.router)
app.include_router(captures.router)
app.include_router(export.router)
