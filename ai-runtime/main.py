import os
import logging
from contextlib import asynccontextmanager

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import structlog

from api.routes import router as api_router
from api.chart_generator.routes import router as chart_router
from api.websocket import sio
from services.config import settings
from services.cache_service import cache_service
from services.state_checkpointer import state_checkpointer

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logging.basicConfig(
    format="%(message)s",
    level=getattr(logging, settings.log_level.upper()),
)

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting AI Runtime Backend", port=settings.port)
    # Initialize services
    await cache_service.connect()
    await state_checkpointer.initialize()
    yield
    # Cleanup
    await cache_service.close()
    await state_checkpointer.close()
    logger.info("Shutting down AI Runtime Backend")


app = FastAPI(
    title="AI Query Platform - AI Runtime",
    description="Multi-tenant Enterprise AI Query Platform Runtime Engine",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")
app.include_router(chart_router, prefix="/api/chart-generator", tags=["Chart Generator"])

# Mount Socket.IO - use socketio_path to specify the mount point
socket_app = socketio.ASGIApp(
    sio,
    other_asgi_app=app,
    socketio_path='/socket.io'
)


@app.get("/")
async def root():
    return {
        "name": "AI Query Platform - AI Runtime",
        "version": "1.0.0",
        "status": "running"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:socket_app",
        host="0.0.0.0",
        port=settings.port,
        reload=settings.log_level.lower() == "debug"
    )
