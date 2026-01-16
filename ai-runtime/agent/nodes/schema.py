import re
import difflib
import json
from typing import Dict, Any, List, Optional
import structlog

from agent.nodes.base import BaseNode, QueryState

logger = structlog.get_logger()

class SchemaNodes(BaseNode):
    async def schema_search(self, state: QueryState) -> Dict:
        """Identify relevant tables from database schema with weighted scoring and expansion"""
        try:
            # Skip if we already have relevant schema (optimized for simple refinements)
            # But proceed if intent explicitly identified relevant tables to ensure they are merged
            if state.get("relevant_schema") and state.get("is_refinement") and \
               not state.get("needs_schema_search") and not state.get("relevant_tables_from_intent"):
                return {
                    "relevant_schema": state["relevant_schema"],
                    "current_step": "schema_searched",
                    "no_match": False
                }

            user_message = state["user_message"]
            search_query = user_message
            if state.get("is_refinement") and state.get("previous_user_message"):
                search_query = f"{state['previous_user_message']} {user_message}"
                if state.get("new_entities"):
                    search_query += " " + " ".join(state["new_entities"])

            logger.info("Starting schema search", search_query=search_query)

            # --- 1. Vector Search ---
            query_embedding = await self.embedding_service.generate_single_embedding(search_query)
            vector_results = []
            if query_embedding:
                raw_results = await self.system_db.search_similar_vectors(
                    state["agent_id"], query_embedding, limit=20
                )
                vector_results = [r for r in raw_results if r.get("similarity", 0) >= 0.5 and r.get("target_type") == "table"]

            # --- 2. Keyword/Fuzzy Hybrid Search ---
            tokens = set(re.findall(r'\w+', user_message.lower()))
            all_tables = state["schema_metadata"].get("tables", [])
            table_by_name = {t["name"].lower(): t for t in all_tables}
            keyword_matches = []
            for t in all_tables:
                t_name = t["name"].lower()
                if t_name in tokens: 
                    keyword_matches.append(t)
                else:
                    for token in tokens:
                        if len(token) > 2 and difflib.SequenceMatcher(None, token, t_name).ratio() > 0.85:
                            keyword_matches.append(t)
                            break

            # Match intent tables
            intent_matches = []
            intent_table_names = state.get("relevant_tables_from_intent", [])
            for name in intent_table_names:
                if name.lower() in table_by_name:
                    intent_matches.append(table_by_name[name.lower()])
                # Handle fuzzy/partial matches from intent
                else:
                    for t_name, t_obj in table_by_name.items():
                        if difflib.SequenceMatcher(None, name.lower(), t_name).ratio() > 0.85:
                            intent_matches.append(t_obj)
                            break

            # --- 3. Weighted Scoring ---
            table_scores = {}
            # Base results from vector search
            for r in vector_results:
                metadata = r.get("metadata", {})
                if isinstance(metadata, str): metadata = json.loads(metadata)
                t_name = metadata.get("table_name")
                if t_name and t_name.lower() in table_by_name:
                    table_scores[t_name] = table_scores.get(t_name, 0) + (r["similarity"] * 10.0)

            # Boost keyword matches
            for t in keyword_matches:
                t_name = t["name"]
                table_scores[t_name] = table_scores.get(t_name, 0) + 15.0

            # Boost intent matches (Highest Priority)
            for t in intent_matches:
                t_name = t["name"]
                table_scores[t_name] = table_scores.get(t_name, 0) + 25.0

            # Sort and take top 10 candidates
            sorted_candidates = sorted(table_scores.items(), key=lambda x: x[1], reverse=True)[:10]
            final_relevant_tables = [table_by_name[name.lower()] for name, _ in sorted_candidates]

            # --- 4. FK Relationship Expansion ---
            if final_relevant_tables:
                final_relevant_tables = self._expand_with_related_tables(
                    final_relevant_tables, all_tables, state["schema_metadata"]
                )

            # --- 5. Refinement Merging ---
            if state.get("is_refinement") and state.get("relevant_schema"):
                prev_tables = {t["name"].lower(): t for t in state["relevant_schema"]}
                for t in final_relevant_tables:
                    prev_tables[t["name"].lower()] = t
                final_relevant_tables = list(prev_tables.values())[:25]
            else:
                final_relevant_tables = final_relevant_tables[:25]

            if not final_relevant_tables:
                return {"no_match": True, "relevant_schema": [], "current_step": "schema_searched"}

            return {
                "relevant_schema": final_relevant_tables,
                "no_match": False,
                "current_step": "schema_searched"
            }
        except Exception as e:
            logger.error("Schema search failed", error=str(e))
            fallback = state.get("relevant_schema") if state.get("is_refinement") else state["schema_metadata"].get("tables", [])
            return {
                "relevant_schema": fallback,
                "no_match": not fallback,
                "current_step": "schema_searched",
                "schema_search_failed": True
            }
