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

class ChartDataUpdateRequest(BaseModel):
    all_chart_schemas: list | None = None
    indicator_list: list | None = None
    dimension_list: list | None = None

@router.post("/update_data")
async def update_chart_data(
    request: ChartDataUpdateRequest = Body(...)
):
    """
    Update the underlying data.json used by the chart generator service.
    Accepts updates for all_chart_schemas, indicator_list, and dimension_list.
    """
    try:
        # Convert request model to dict, excluding None values
        updates = request.model_dump(exclude_unset=True)
        
        if not updates:
             raise HTTPException(status_code=400, detail="No updates provided")

        result = await service.update_data(updates)
        
        if result.get("status") == "error":
             raise HTTPException(status_code=500, detail=result.get("message"))
             
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error("API Error in update data", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
