# Embeddings API 403 Authentication Fix

## Problem

When NestJS backend calls the FastAPI `/embeddings/generate` endpoint with super admin role, it was getting 403 unauthorized errors. The issue was that the JWT token was not being passed from NestJS to FastAPI.

## Root Cause

The `callEmbeddingService()` method in `embeddings.service.ts` was making HTTP POST requests to FastAPI without including an Authorization header. FastAPI's `/embeddings/generate` endpoint requires admin authentication via the `require_admin` dependency, which validates a Bearer token.

**Authentication Flow:**
1. Frontend → NestJS: User authenticates and gets JWT token
2. Frontend → NestJS: Sends requests with `Authorization: Bearer <token>` header
3. NestJS → FastAPI: **MISSING** - Was not forwarding the token
4. FastAPI: Expects `Authorization: Bearer <token>` header to validate admin role

## Solution

### Changes Made

#### 1. Updated `embeddings.service.ts`

**Method Signatures:**
- `generateEmbeddings(agentId, userId, authToken?)` - Added optional `authToken` parameter
- `searchSimilar(agentId, query, limit, authToken?)` - Added optional `authToken` parameter
- `callEmbeddingService(texts, authToken?)` - Added optional `authToken` parameter

**Authorization Header:**
```typescript
private async callEmbeddingService(texts: string[], authToken?: string): Promise<number[][]> {
  try {
    const headers: Record<string, string> = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await firstValueFrom(
      this.httpService.post<EmbeddingResponse>(
        `${this.aiRuntimeUrl}/api/embeddings/generate`,
        { texts, model: 'text-embedding-3-small' },
        {
          timeout: 60000,
          headers  // ← Added headers with Authorization
        }
      )
    );

    return (response.data as EmbeddingResponse).embeddings;
  } catch (error) {
    console.error('Failed to generate embeddings:', error);
    return texts.map(() => new Array(1536).fill(0));
  }
}
```

#### 2. Updated `embeddings.controller.ts`

**Extract JWT Token from Request:**

```typescript
@Post('generate')
@Roles('super_admin', 'admin')
async generateEmbeddings(
  @Param('agentId', ParseUUIDPipe) agentId: string,
  @Request() req: any,
) {
  // Extract the JWT token from the Authorization header
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  return this.embeddingsService.generateEmbeddings(agentId, req.user.sub, token);
}
```

```typescript
@Get('search')
async searchSimilar(
  @Param('agentId', ParseUUIDPipe) agentId: string,
  @Query('query') query: string,
  @Query('limit') limit?: string,
  @Request() req?: any,
) {
  // Extract the JWT token from the Authorization header
  const authHeader = req?.headers?.authorization;
  const token = authHeader?.replace('Bearer ', '');

  return this.embeddingsService.searchSimilar(
    agentId,
    query,
    limit ? parseInt(limit, 10) : 10,
    token,
  );
}
```

## How It Works Now

1. **User Authentication**: User logs in to frontend with super_admin role, receives JWT token
2. **Request to NestJS**: Frontend calls NestJS `/agents/:agentId/embeddings/generate` with `Authorization: Bearer <token>` header
3. **NestJS JWT Guard**: `JwtAuthGuard` validates token and attaches user to request object
4. **Extract Token**: Controller extracts token from `req.headers.authorization`
5. **Pass to Service**: Controller passes token to service method
6. **Forward to FastAPI**: Service includes token in Authorization header when calling FastAPI
7. **FastAPI Validation**: FastAPI's `require_admin` dependency validates token and checks role
8. **Success**: Request proceeds if user has admin or super_admin role

## FastAPI Authentication Details

**File:** `/ai-runtime/services/auth.py`

```python
async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin" and user.role != "super_admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user
```

**JWT Payload Structure:**
- `sub` or `id`: User ID
- `email`: User email
- `role`: User role (must be "admin" or "super_admin")

## Testing

To test the fix:

1. **Build and start services:**
   ```bash
   docker-compose build
   docker-compose up
   ```

2. **Login as super_admin:**
   - POST `/api/auth/login` with super_admin credentials
   - Save the `accessToken` from response

3. **Generate embeddings:**
   - POST `/api/agents/:agentId/embeddings/generate`
   - Include `Authorization: Bearer <accessToken>` header
   - Should return 200 with embeddings count

4. **Check logs:**
   - No 403 errors in FastAPI logs
   - No "Token verification failed" errors

## Files Modified

1. `/admin-backend/src/modules/embeddings/embeddings.service.ts` (lines 44, 86, 128, 180-203)
2. `/admin-backend/src/modules/embeddings/embeddings.controller.ts` (lines 32-45, 47-68)

## Benefits

- ✅ Fixes 403 authentication errors when calling embeddings endpoint
- ✅ Properly validates admin permissions on FastAPI side
- ✅ Maintains security by requiring valid JWT tokens for inter-service calls
- ✅ No breaking changes - authToken parameter is optional (backward compatible)
- ✅ Consistent with authentication patterns across the platform
