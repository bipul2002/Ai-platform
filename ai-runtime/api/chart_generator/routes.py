from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel
import structlog

from api.chart_generator.service import ChartGeneratorService

router = APIRouter()
logger = structlog.get_logger()
service = ChartGeneratorService()

class ChartGenRequest(BaseModel):
    query: str

class ChartGenResponse(BaseModel):
    # We return flexible dict because the schema is dynamic based on chart type
    # but strictly follows the rules in prompt
    result: dict

@router.post("/generate")
async def generate_chart_config(
    request: ChartGenRequest = Body(...)
):
    """
    Generate chart configuration from natural language query.
    This endpoint is OPEN (no authentication required).
    """
    try:
        if not request.query:
            raise HTTPException(status_code=400, detail="Query cannot be empty")
            
        result = await service.generate_config(request.query)
        
        # Check for explicit error keys in the result from service
        if "error" in result and result["error"] != "INSUFFICIENT_INFORMATION":
             # If it's an internal error (like JSON parse), we might want to return 500 or 422
             # But if it's "INSUFFICIENT_INFORMATION", that's a valid business logic response.
             pass
             
        # Just return the JSON directly. 
        # The user wrapper might expect { "result": ... } or direct.
        # Let's return direct JSON to be cleaner? 
        # The prompt says "The output MUST ALWAYS be valid JSON and follow EXACTLY this structure".
        # So we should probably just return that structure.
        return result

    except Exception as e:
        logger.error("API Error in chart generation", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
