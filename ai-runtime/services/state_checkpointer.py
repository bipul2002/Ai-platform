"""
LangGraph State Persistence using PostgreSQL checkpointer.
Enables workflow resumption and state tracking.
"""
import os
from typing import Optional
import structlog

logger = structlog.get_logger()

# Try to import checkpoint, gracefully handle if not available
try:
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    CHECKPOINT_AVAILABLE = True
except ImportError:
    logger.warning("langgraph-checkpoint-postgres not installed, state persistence disabled")
    AsyncPostgresSaver = None
    CHECKPOINT_AVAILABLE = False

from services.config import settings

class StateCheckpointer:
    """Manages LangGraph state persistence"""
    
    def __init__(self):
        self.checkpointer: Optional[AsyncPostgresSaver] = None
        
    async def initialize(self):
        """Initialize PostgreSQL checkpointer"""
        if not CHECKPOINT_AVAILABLE:
            logger.warning("Checkpoint module not available, state persistence disabled")
            return
            
        try:
            # Use system DB URL for checkpoints
            self.checkpointer = await AsyncPostgresSaver.from_conn_string(
                settings.system_db_url
            )
            await self.checkpointer.setup()
            logger.info("LangGraph checkpointer initialized")
        except Exception as e:
            logger.warning("Failed to initialize checkpointer, state persistence disabled", error=str(e))
            self.checkpointer = None
    
    async def close(self):
        """Close checkpointer connection"""
        if self.checkpointer:
            # AsyncPostgresSaver doesn't have explicit close, connections are managed by pool
            logger.info("LangGraph checkpointer closed")
    
    def get_checkpointer(self) -> Optional[AsyncPostgresSaver]:
        """Get the checkpointer instance"""
        return self.checkpointer

# Global checkpointer instance
state_checkpointer = StateCheckpointer()
