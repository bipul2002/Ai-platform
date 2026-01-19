import json
import os
import structlog
from typing import Dict, Any, Optional

from agent.llm import get_llm
from langchain_core.messages import SystemMessage, HumanMessage

logger = structlog.get_logger()

class ChartGeneratorService:
    def __init__(self):
        self.base_path = os.path.dirname(os.path.abspath(__file__))
        self.prompt_path = os.path.join(self.base_path, "prompt.txt")
        self.data_path = os.path.join(self.base_path, "data.json")
        self._load_resources()

    def _load_resources(self):
        try:
            with open(self.prompt_path, "r", encoding="utf-8") as f:
                self.prompt_template = f.read()
            
            with open(self.data_path, "r", encoding="utf-8") as f:
                self.data = json.load(f)
                
            logger.info("ChartGeneratorService resources loaded successfully")
        except Exception as e:
            logger.error("Failed to load ChartGeneratorService resources", error=str(e))
            self.prompt_template = ""
            self.data = {}

    async def generate_config(self, user_query: str) -> Dict[str, Any]:
        """
        Generate chart configuration based on user query using the stored prompt and data.
        """
        try:
            # 1. Prepare Prompt
            # Safely get data lists, defaulting to empty JSON array string if missing
            all_chart_schemas = json.dumps(self.data.get("all_chart_schemas", []), indent=2)
            indicator_list = json.dumps(self.data.get("indicator_list", []), indent=2)
            dimension_list = json.dumps(self.data.get("dimension_list", []), indent=2)

            # Replace placeholders
            system_prompt = self.prompt_template.replace(
                "{{ALL_CHART_SCHEMAS_JSON}}", all_chart_schemas
            ).replace(
                "{{INDICATOR_LIST_JSON}}", indicator_list
            ).replace(
                "{{DIMENSION_LIST_JSON}}", dimension_list
            ).replace(
                "{{USER_NATURAL_LANGUAGE_QUERY}}", user_query
            )

            # 2. Get LLM Instance
            # Use OpenRouter as requested by the user, with low temperature for strict output
            llm = get_llm(provider="openrouter",model='meta-llama/llama-3.3-70b-instruct:free', temperature=0.0)

            # 3. Invoke LLM
            logger.info("Invoking LLM for chart configuration generation", query=user_query)
            response = await llm.ainvoke([
                SystemMessage(content=system_prompt),
                # Note: The user query is already embedded in the system prompt template as per instructions,
                # but it's often safer to also pass it as a user message or just rely on the prompt.
                # The prompt template has "User Request: {{...}}", so we might not need a separate HumanMessage 
                # if we strictly follow the template. However, LangChain usually expects a conversation.
                # Let's check the template again. It ends with "Generate the final chart configuration JSON now."
                # So we can just send the SystemMessage (which contains the user query) or 
                # split it. Given the template structure, it looks like a single block instructions.
                # We'll send it as a single SystemMessage or HumanMessage. 
                # Sending as SystemMessage is robust for "instructions". 
                # If we want to be very chat-like, we could put the instructions in System and Query in Human,
                # but the template merges them. So we will use a single SystemMessage or HumanMessage.
                # Let's use HumanMessage to ensure the model treats it as a request to process.
                # Wait, "You are a Chart Configuration Generator..." is clearly system instruction.
                # Let's try sending it as SystemMessage.
            ])

            # 4. Parse Response
            content = response.content
            
            # clean code blocks if present
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()

            try:
                result = json.loads(content)
                return result
            except json.JSONDecodeError:
                logger.error("Failed to parse LLM response as JSON", content=content)
                return {
                    "error": "INVALID_JSON_RESPONSE", 
                    "raw_response": content
                }

        except Exception as e:
            logger.error("Chart configuration generation failed", error=str(e))
            return {"error": str(e)}

    async def update_data(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        """
        Update the data.json file with provided updates.
        """
        try:
            # Update internal state if keys exist in updates
            if "all_chart_schemas" in updates:
                self.data["all_chart_schemas"] = updates["all_chart_schemas"]
            if "indicator_list" in updates:
                self.data["indicator_list"] = updates["indicator_list"]
            if "dimension_list" in updates:
                self.data["dimension_list"] = updates["dimension_list"]

            # Persist to disk
            with open(self.data_path, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=4)
            
            logger.info("data.json updated successfully")
            return {"status": "success", "message": "Data updated successfully"}

        except Exception as e:
            logger.error("Failed to update data.json", error=str(e))
            return {"status": "error", "message": str(e)}
