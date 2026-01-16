import asyncio
import structlog
from typing import Dict, List, Any, Optional, Set

logger = structlog.get_logger()

class QueryJobManager:
    """
    Manages active query jobs to support multitasking and persistence across reloads.
    Singleton pattern ensures global state.
    """
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(QueryJobManager, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
            
        self._initialized = True
        # conversation_id -> { task: asyncio.Task, subscribers: Set[sid], ... }
        self._active_jobs: Dict[str, Dict[str, Any]] = {} 
        # conversation_id -> List[event] (history of recent events for replay)
        self._event_buffers: Dict[str, List[Dict]] = {}
        
        logger.info("QueryJobManager initialized")

    def submit_job(self, conversation_id: str, coro, sid: str):
        """
        Submit a new query job.
        Cancels any existing job for this conversation.
        """
        # Cancel existing job if any
        if conversation_id in self._active_jobs:
            logger.info("Canceling existing job for conversation", conversation_id=conversation_id)
            old_task = self._active_jobs[conversation_id].get("task")
            if old_task and not old_task.done():
                old_task.cancel()
        
        # Initialize buffer
        self._event_buffers[conversation_id] = []
        
        # Create new task
        task = asyncio.create_task(coro)
        
        self._active_jobs[conversation_id] = {
            "task": task,
            "subscribers": {sid}, # Start with the submitter subscribed
            "status": "running"
        }
        
        # Cleanup callback
        def cleanup(f):
            try:
                f.result() # Check for exceptions
            except asyncio.CancelledError:
                logger.info("Job cancelled", conversation_id=conversation_id)
            except Exception as e:
                logger.error("Job failed", conversation_id=conversation_id, error=str(e))
            finally:
                # Mark as done but keep history for a bit? 
                # Ideally we clear active job but maybe keep history buffer for a short time
                # For now, just remove from active_jobs so we know it's not running
                if conversation_id in self._active_jobs and self._active_jobs[conversation_id]["task"] == task:
                    self._active_jobs[conversation_id]["status"] = "completed"
                    # Don't delete immediately, let user see "completed" state if they reconnect
                    # But we can rely on DB for completed state. 
                    # The Buffer is useful for "thinking" events which are NOT in DB.
                    pass
                    
        task.add_done_callback(cleanup)
        logger.info("Job submitted", conversation_id=conversation_id)
        return task

    def subscribe(self, conversation_id: str, sid: str) -> bool:
        """
        Subscribe a socket ID to an active job.
        Returns True if job exists and is running/active.
        """
        if conversation_id in self._active_jobs:
            self._active_jobs[conversation_id]["subscribers"].add(sid)
            logger.info("Client subscribed to job", conversation_id=conversation_id, sid=sid)
            return True
        return False

    def unsubscribe(self, conversation_id: str, sid: str):
        if conversation_id in self._active_jobs:
            self._active_jobs[conversation_id]["subscribers"].discard(sid)

    def get_subscribers(self, conversation_id: str) -> Set[str]:
        if conversation_id in self._active_jobs:
            return self._active_jobs[conversation_id]["subscribers"]
        return set()

    def add_event(self, conversation_id: str, event: Dict):
        """Add event to buffer for replay"""
        if conversation_id not in self._event_buffers:
            self._event_buffers[conversation_id] = []
        
        # Keep last 50 events max
        if len(self._event_buffers[conversation_id]) > 50:
            self._event_buffers[conversation_id].pop(0)
            
        self._event_buffers[conversation_id].append(event)

    def get_events(self, conversation_id: str) -> List[Dict]:
        return self._event_buffers.get(conversation_id, [])

    def is_running(self, conversation_id: str) -> bool:
        return conversation_id in self._active_jobs and self._active_jobs[conversation_id]["status"] == "running"

# Global instance
job_manager = QueryJobManager()
