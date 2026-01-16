from typing import Optional, Dict, Any
from jose import jwt, JWTError
from fastapi import HTTPException, Security, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import structlog

from services.config import settings

logger = structlog.get_logger()
security = HTTPBearer()

class User(BaseModel):
    id: str
    email: str
    role: str
    agent_id: Optional[str] = None
    api_key_id: Optional[str] = None
    user_id: Optional[str] = None

class AuthService:
    def verify_token(self, token: str) -> Dict[str, Any]:
        try:
            payload = jwt.decode(
                token,
                settings.jwt_secret,
                algorithms=[settings.jwt_algorithm]
            )
            return payload
        except JWTError as e:
            logger.error("Token verification failed", error=str(e), token_preview=token[:10] + "..." if token else "None")
            raise HTTPException(status_code=401, detail=f"Could not validate credentials: {str(e)}")

auth_service = AuthService()

async def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)) -> User:
    token = credentials.credentials
    payload = auth_service.verify_token(token)
    
    sub = payload.get("sub") or payload.get("id")
    email = payload.get("email")
    role = payload.get("role", "viewer")
    agent_id = payload.get("agentId")
    
    if role == "api_key":
        user_id = None
        api_key_id = sub
    else:
        user_id = sub
        api_key_id = payload.get("apiKeyId")
    
    if not sub:
        raise HTTPException(status_code=401, detail="Invalid token payload: missing subject")
        
    return User(
        id=str(sub), 
        email=str(email), 
        role=role,
        agent_id=agent_id,
        api_key_id=api_key_id,
        user_id=user_id
    )

async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in ["admin", "super_admin"]:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user

async def require_admin_or_api_key(user: User = Depends(get_current_user)) -> User:
    if user.role not in ["admin", "super_admin", "api_key"]:
        raise HTTPException(status_code=403, detail="Insufficient privileges")
    return user

async def require_authenticated(user: User = Depends(get_current_user)) -> User:
    """Require any authenticated user (admin, viewer, or api_key)"""
    return user
