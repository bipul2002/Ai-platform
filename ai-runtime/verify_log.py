import sys
import os
import asyncio
from unittest.mock import MagicMock, AsyncMock
import structlog

# Add current directory to sys.path so we can import api
sys.path.append(os.getcwd())

# Configure structlog to print to console
structlog.configure(
    processors=[
        structlog.processors.JSONRenderer()
    ],
    logger_factory=structlog.PrintLoggerFactory(),
)

# Mock the service before importing routes
# We need to mock api.chart_generator.service.ChartGeneratorService
# But routes.py imports it and instantiates it globally.
# So we need to patch it *after* import or mock the module before import.

# Let's import routes
from api.chart_generator import routes

# Mock the service instance in routes
mock_service = AsyncMock()
mock_service.update_data.return_value = {"status": "success", "message": "Data updated successfully"}
routes.service = mock_service

# Create a request object
from api.chart_generator.routes import ChartDataUpdateRequest

async def run_test():
    print("--- Starting Test ---")
    
    # Test case 1: Valid update
    request = ChartDataUpdateRequest(
        indicator_list=[{"id": "test", "name": "Test Indicator"}]
    )
    
    print("\nInvoking update_chart_data...")
    try:
        result = await routes.update_chart_data(request)
        print(f"Result: {result}")
    except Exception as e:
        print(f"Error: {e}")

    # Test case 2: Empty update (should fail)
    print("\nInvoking update_chart_data with no updates...")
    try:
        empty_request = ChartDataUpdateRequest()
        await routes.update_chart_data(empty_request)
    except Exception as e:
        print(f"Caught expected error: {e}")

if __name__ == "__main__":
    asyncio.run(run_test())
