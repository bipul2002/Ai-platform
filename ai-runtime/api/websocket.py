import socketio
import structlog
from typing import Dict, Any
import asyncio
import uuid

from agent.query_pipeline import QueryPipeline
from services.system_db import SystemDBService

logger = structlog.get_logger()

sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',
    logger=False,
    engineio_logger=False
)

active_sessions: Dict[str, Dict[str, Any]] = {}
system_db = SystemDBService()


from services.auth import auth_service
from services.query_job_manager import job_manager

@sio.event
async def connect(sid, environ, auth):
    logger.info("Client connecting", sid=sid)
    
    token = None
    if auth:
        token = auth.get('token')
    
    # Also check query params if not in auth dict
    if not token:
        print(environ)
        query_string = environ.get('QUERY_STRING', '')
        logger.info("QUERY String###### "+query_string)
        # Simple parsing, ideally use urllib.parse
        for param in query_string.split('&'):
            if param.startswith('token='):
                token = param.split('=')[1]
                break
    logger.info("Token###### "+token)
    if not token:
        logger.warning("Connection rejected: No token provided", sid=sid)
        return False  # Reject connection
        
    try:
        payload = auth_service.verify_token(token)
        sub = payload.get("sub") or payload.get("id")
        role = payload.get("role", "viewer")

        # Extract API key info from JWT payload
        # For API key tokens, 'sub' is the API Key ID.
        # For regular users, 'sub' is the User ID.
        if role == "api_key":
            user_id = None
            api_key_id = sub
        else:
            user_id = sub
            api_key_id = payload.get("apiKeyId")

        api_key_name = payload.get("apiKeyName")
        agent_id = payload.get("agentId")
        organization_id = payload.get("organizationId")

        logger.info("Extracted payload for WebSocket", 
                    sub=payload.get("sub"), 
                    role=role, 
                    agent_id=agent_id, 
                    api_key_id=api_key_id,
                    organization_id=organization_id)

        # Save to ONLY sio.session to avoid sync issues.
        # But we can keep active_sessions for easy access if needed, but must sync.
        # Ideally we just use sio.session.

        async with sio.session(sid) as session:
            session['user_id'] = user_id
            session['role'] = role
            session['email'] = payload.get("email")
            session['session_id'] = str(uuid.uuid4())
            session['context'] = []
            session['api_key_id'] = api_key_id
            session['api_key_name'] = api_key_name
            session['agent_id'] = agent_id
            session['organization_id'] = organization_id

        active_sessions[sid] = {
            "agent_id": agent_id,
            "organization_id": organization_id,
            "context": [],
            "session_id": str(uuid.uuid4()),
            "user": {
                "id": user_id,
                "role": role,
                "email": payload.get("email")
            },
            "api_key_id": api_key_id,
            "api_key_name": api_key_name
        }
        logger.info("Client connected and authenticated", sid=sid, user_id=user_id, api_key_id=api_key_id, agent_id=agent_id)
        await sio.emit('connected', {'sid': sid}, room=sid)
        
    except Exception as e:
        logger.warning("Connection rejected: Invalid token", sid=sid, error=str(e))
        return False


@sio.event
async def disconnect(sid):
    logger.info("Client disconnected", sid=sid)
    if sid in active_sessions:
        del active_sessions[sid]


@sio.event
async def set_agent(sid, data):
    agent_id = data.get('agent_id')
    if not agent_id:
        await sio.emit('error', {'message': 'agent_id is required'}, room=sid)
        return
    
    try:
        config = await system_db.get_agent_config(agent_id)
        
        async with sio.session(sid) as session:
            session['agent_id'] = agent_id
            session['config'] = config
            
        active_sessions[sid]['agent_id'] = agent_id
        active_sessions[sid]['config'] = config
        
        await sio.emit('agent_set', {'agent_id': agent_id, 'name': config.get('name')}, room=sid)
        logger.info("Agent set for session", sid=sid, agent_id=agent_id)
    except Exception as e:
        logger.error("Failed to set agent", sid=sid, agent_id=agent_id, error=str(e))
        await sio.emit('error', {'message': f'Failed to set agent: {str(e)}'}, room=sid)


@sio.event
async def set_conversation(sid, data):
    conversation_id = data.get('conversation_id')
    
    # Allow clearing conversation if explicitly set to None
    if conversation_id is None:
        async with sio.session(sid) as session:
            session['conversation_id'] = None
        if sid in active_sessions:
            active_sessions[sid]['conversation_id'] = None
        await sio.emit('conversation_set', {'id': None, 'history': []}, room=sid)
        logger.info("Conversation cleared", sid=sid)
        return

    try:
        # Update session
        async with sio.session(sid) as session:
            session['conversation_id'] = conversation_id
            
        if sid in active_sessions:
            active_sessions[sid]['conversation_id'] = conversation_id
            
        await sio.emit('conversation_set', {
            'id': conversation_id
        }, room=sid)
        logger.info("Conversation set", sid=sid, conversation_id=conversation_id)

        # Check for active job and subscribe
        if job_manager.is_running(conversation_id):
            logger.info("Found active job for conversation, subscribing", conversation_id=conversation_id, sid=sid)
            job_manager.subscribe(conversation_id, sid)
            
            # Replay recent events
            events = job_manager.get_events(conversation_id)
            for event in events:
                await sio.emit(event['event'], event['data'], room=sid)
                
    except Exception as e:
        logger.error("Failed to set conversation", sid=sid, error=str(e))
        await sio.emit('error', {'message': str(e)}, room=sid)


@sio.event
async def new_conversation(sid, data):
    try:
        # Get agent_id/user_id from sio.session ideally, but active_sessions is simpler for read outside async with
        # Let's rely on sio.session for truth for consistency
        async with sio.session(sid) as session:
            agent_id = session.get('agent_id')
            user_id = session.get('user_id')
        
        if not agent_id:
             await sio.emit('error', {'message': 'Agent not set'}, room=sid)
             return

        conv = await system_db.create_conversation(agent_id, user_id, api_key_id=session.get('api_key_id'), title="New Conversation")
        
        async with sio.session(sid) as session:
            session['conversation_id'] = conv['id']
        
        if sid in active_sessions:
            active_sessions[sid]['conversation_id'] = conv['id']
            # Clear context in memory if we were caching it (we are strictly DB now)
            
        await sio.emit('conversation_created', conv, room=sid)
        logger.info("New conversation created", sid=sid, conversation_id=conv['id'])
    except Exception as e:
        logger.error("Failed to create conversation", sid=sid, error=str(e))
        await sio.emit('error', {'message': str(e)}, room=sid)


@sio.event
async def query(sid, data):
    session = active_sessions.get(sid)
    if not session:
        await sio.emit('error', {'message': 'Session not found'}, room=sid)
        return
    
    agent_id = session.get('agent_id')
    if not agent_id:
        await sio.emit('error', {'message': 'No agent selected. Call set_agent first.'}, room=sid)
        return
    
    user_message = data.get('message', '').strip()
    message_id = str(uuid.uuid4())
    user_message = data.get('message')
    
    if not user_message:
        await sio.emit('error', {'message': 'Message is required'}, room=sid)
        return

    try:
        logger.info("Starting query processing", sid=sid, message_id=message_id)

        async with sio.session(sid) as session:
            logger.info("Session lock acquired", sid=sid)
            agent_id = session.get('agent_id')
            conversation_id = session.get('conversation_id')
            user_id = session.get('user_id')
            api_key_id = session.get('api_key_id')
            api_key_name = session.get('api_key_name')
            organization_id = session.get('organization_id')
            
            logger.info("Retrieved session data for query", 
                        sid=sid, 
                        agent_id=agent_id, 
                        conversation_id=conversation_id, 
                        api_key_id=api_key_id,
                        organization_id=organization_id)
            
            # Re-fetch session data if needed
            if not agent_id:
                logger.error("No agent selected in session", sid=sid)
                await sio.emit('error', {'message': 'No agent selected. Call set_agent first.'}, room=sid)
                return
            
            # If no conversation selected, create one implicitly
            is_new_conversation = False
            if not conversation_id:
                logger.info("Creating implicit conversation", sid=sid)
                conv = await system_db.create_conversation(agent_id, user_id, api_key_id=api_key_id, title=user_message[:50])
                conversation_id = conv['id']
                session['conversation_id'] = conversation_id
                await sio.emit('conversation_created', conv, room=sid)
                is_new_conversation = True

            # Get thread_id from request (NEW)
            thread_id = data.get('thread_id')
            if not thread_id:
                thread_id = f"thread_{uuid.uuid4().hex[:16]}"
                logger.info("Generated new thread_id for initial request", thread_id=thread_id)

            # Check if this is the first message in the conversation
            if not is_new_conversation:
                existing_messages = await system_db.get_conversation_history(conversation_id, limit=1)
                is_first_message = len(existing_messages) == 0
            else:
                is_first_message = True

            # Send welcome message for first interaction
            if is_first_message:
                welcome_message = "Hey there! 👋 How can I help you today?"
                welcome_msg_id = str(uuid.uuid4())

                logger.info("Sending welcome message", conversation_id=conversation_id)

                # Save welcome message to database first
                await system_db.add_message(
                    conversation_id,
                    'assistant',
                    welcome_message,
                    metadata={
                        'is_welcome': True,
                        'agent_id': agent_id
                    }
                )

                # Send welcome message to frontend using dedicated event
                # Using 'welcome_message' event instead of 'query_complete' for clarity
                await sio.emit('welcome_message', {
                    'message_id': welcome_msg_id,
                    'response': welcome_message,
                    'conversation_id': conversation_id,
                    'agent_id': agent_id
                }, room=sid)

                # Also emit as query_complete for backward compatibility with frontend
                await sio.emit('query_complete', {
                    'message_id': welcome_msg_id,
                    'response': welcome_message,
                    'result_type': 'text',
                    'is_welcome': True,
                    'agent_id': agent_id,
                    'data_fetched': False
                }, room=sid)

            # 2. Get History (Thread-scoped ONLY for refinements)
            # A refinement is detected if thread_id was ALREADY in the data (provided by frontend)
            is_requested_refinement = bool(data.get('thread_id'))
            if is_requested_refinement:
                logger.info("Fetching thread-scoped history for refinement", sid=sid, thread_id=thread_id)
                context = await system_db.get_thread_history(thread_id, limit=10)
                logger.info("Thread history fetched for refinement", sid=sid, context_length=len(context))
            else:
                logger.info("New query detected - no history context sent to LLM", sid=sid)
                context = []

            # 3. Save User Message with thread_id
            logger.info("Saving user message", sid=sid, conversation_id=conversation_id, thread_id=thread_id)
            await system_db.add_message(conversation_id, 'user', user_message, thread_id=thread_id)

            # Emit query_started AFTER saving to DB to ensure correct sorting in frontend
            await sio.emit('query_started', {'message_id': message_id}, room=sid)

        # Submit job to manager
        # Define the job coroutine
        async def job_coroutine():
            logger.info("Executing job coroutine", conversation_id=conversation_id)
            
            async def broadcast(event_name, data):
                job_manager.add_event(conversation_id, {"event": event_name, "data": data})
                subscribers = job_manager.get_subscribers(conversation_id)
                if subscribers:
                    # Emit to all subscribers in parallel
                    await asyncio.gather(*[
                        sio.emit(event_name, data, room=sub_sid) 
                        for sub_sid in subscribers
                    ])

            try:
                logger.info("Initializing QueryPipeline", agent_id=agent_id, thread_id=thread_id, api_key_id=api_key_id)
                pipeline = QueryPipeline(agent_id, conversation_id, user_id=user_id, api_key_id=api_key_id, api_key_name=api_key_name)
                assistant_response_chunks = []

                async for chunk in pipeline.process(user_message, context, thread_id=thread_id):
                    chunk_type = chunk.get('type')
                    
                    if chunk_type == 'thinking':
                        await broadcast('thinking', {
                            'message_id': message_id,
                            'conversation_id': conversation_id,
                            'stage': chunk.get('stage'),
                            'message': chunk.get('message')
                        })
                    
                    elif chunk_type == 'sql':
                        await broadcast('sql_generated', {
                            'message_id': message_id,
                            'sql': chunk.get('sql'),
                            'dialect': chunk.get('dialect')
                        })
                    
                    elif chunk_type == 'stream':
                        content = chunk.get('content')
                        if content:
                            assistant_response_chunks.append(content)
                        await broadcast('response_chunk', {
                            'message_id': message_id,
                            'content': content
                        })
                    
                    elif chunk_type == 'result':
                        await broadcast('query_result', {
                            'message_id': message_id,
                            'data': chunk.get('data'),
                            'row_count': chunk.get('row_count')
                        })
                    
                    elif chunk_type == 'error':
                        await broadcast('query_error', {
                            'message_id': message_id,
                            'conversation_id': conversation_id,
                            'error': chunk.get('error'),
                            'details': chunk.get('details')
                        })
                    
                    elif chunk_type == 'complete':
                        final_response = chunk.get('response', '')
                        generated_sql = chunk.get('sql')
                        row_count = chunk.get('row_count')
                        query_results = chunk.get('data', [])
                        thread_id_from_pipeline = chunk.get('thread_id')
                        is_refinement = chunk.get('is_refinement', False)
                        iteration_count = chunk.get('iteration_count', 1)
                        data_fetched = chunk.get('data_fetched', True)

                        if generated_sql:
                            result_type = 'table'
                        elif not data_fetched and not generated_sql:
                            result_type = 'guide'
                        else:
                            result_type = 'text'

                        # Save assistant response
                        await system_db.add_message(
                            conversation_id,
                            'assistant',
                            final_response,
                            metadata={
                                'sql': generated_sql,
                                'row_count': row_count if row_count is not None else 0,
                                'query_results': query_results if data_fetched else [],
                                'result_type': result_type,
                                'agent_id': agent_id
                            },
                            thread_id=thread_id_from_pipeline
                        )

                        complete_event = {
                            'message_id': message_id,
                            'conversation_id': conversation_id,
                            'response': final_response,
                            'thread_id': thread_id_from_pipeline,
                            'is_refinement': is_refinement,
                            'iteration_count': iteration_count,
                            'result_type': result_type,
                            'agent_id': agent_id
                        }

                        if generated_sql:
                            complete_event['sql'] = generated_sql
                            if data_fetched and row_count is not None:
                                preview_data = query_results[:10] if query_results else []
                                has_more = len(query_results) > 10
                                complete_event['row_count'] = row_count
                                complete_event['preview_data'] = preview_data
                                complete_event['has_more'] = has_more

                        await broadcast('query_complete', complete_event)
                
                await system_db.update_agent_last_used(agent_id)
                if api_key_id:
                    await system_db.update_api_key_usage(api_key_id)

            except Exception as e:
                import traceback
                error_msg = str(e)
                logger.error("Query processing failed", error=error_msg, traceback=traceback.format_exc())
                await broadcast('query_error', {
                    'message_id': message_id,
                    'conversation_id': conversation_id,
                    'error': 'Query processing failed',
                    'details': error_msg
                })

        # Submit the job
        job_manager.submit_job(conversation_id, job_coroutine(), sid)

    except Exception as e:
        import traceback
        logger.error("Query setup failed", sid=sid, error=str(e), error_type=type(e).__name__, traceback=traceback.format_exc())
        await sio.emit('query_error', {
            'message_id': message_id,
            'error': 'Query processing failed',
            'details': str(e)
        }, room=sid)


@sio.event
async def clear_context(sid):
        await sio.emit('context_cleared', {}, room=sid)
