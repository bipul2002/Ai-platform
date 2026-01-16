import asyncio
from typing import Dict, Any, List, Optional
import structlog

logger = structlog.get_logger()


class SQLExecutor:
    def __init__(self, connection_details: Dict[str, Any]):
        self.connection_details = connection_details
        self.db_type = connection_details.get("dbType", "postgresql")
        self._pool = None
    
    async def execute(
        self,
        sql: str,
        timeout: int = 30,
        limit: int = 1000
    ) -> List[Dict[str, Any]]:
        if self.db_type == "postgresql":
            return await self._execute_postgres(sql, timeout, limit)
        elif self.db_type == "mysql":
            return await self._execute_mysql(sql, timeout, limit)
        else:
            raise ValueError(f"Unsupported database type: {self.db_type}")
            raise ValueError(f"Unsupported database type: {self.db_type}")
    
    async def validate(self, sql: str) -> Dict[str, Any]:
        """
        Validate SQL query without fetching data using EXPLAIN.
        Returns: {"valid": bool, "error": str}
        """
        try:
            explain_sql = f"EXPLAIN {sql}"
            if self.db_type == "postgresql":
                await self._execute_postgres(explain_sql, timeout=10, limit=0)
            elif self.db_type == "mysql":
                await self._execute_mysql(explain_sql, timeout=10, limit=0)
            else:
                return {"valid": False, "error": f"Unsupported DB type: {self.db_type}"}
            
            return {"valid": True, "error": None}
        except Exception as e:
            logger.warning("Query validation failed", error=str(e))
            return {"valid": False, "error": str(e)}

    async def _execute_postgres(
        self,
        sql: str,
        timeout: int,
        limit: int
    ) -> List[Dict[str, Any]]:
        import asyncpg
        
        logger.info(
            "Attempting PostgreSQL connection",
            host=self.connection_details["host"],
            port=self.connection_details["port"],
            database=self.connection_details["database"],
            user=self.connection_details["username"]
        )
        
        # 1. CONNECT PHASE (Distinct error handling)
        try:
            conn = await asyncpg.connect(
                host=self.connection_details["host"],
                port=self.connection_details["port"],
                database=self.connection_details["database"],
                user=self.connection_details["username"],
                password=self.connection_details["password"],
                ssl=self.connection_details.get("sslEnabled", False),
                timeout=timeout
            )
        except Exception as e:
            # Explicitly prefix error to identify it as connection issue upstream
            logger.error("PostgreSQL connection failed", error=str(e), error_type=type(e).__name__)
            raise ConnectionError(f"DATABASE_CONNECTION_ERROR: {str(e)}") from e
        
        # 2. EXECUTE PHASE
        try:
            rows = await asyncio.wait_for(
                conn.fetch(sql),
                timeout=timeout
            )
            
            results = []
            for row in rows[:limit]:
                results.append(dict(row))
            
            logger.info(
                "PostgreSQL query executed",
                row_count=len(results),
                sql_preview=sql[:100]
            )
            
            return results
            
        finally:
            await conn.close()
    
    async def _execute_mysql(
        self,
        sql: str,
        timeout: int,
        limit: int
    ) -> List[Dict[str, Any]]:
        import aiomysql
        
        # 1. CONNECT PHASE (Distinct error handling)
        try:
            conn = await aiomysql.connect(
                host=self.connection_details["host"],
                port=self.connection_details["port"],
                db=self.connection_details["database"],
                user=self.connection_details["username"],
                password=self.connection_details["password"],
                connect_timeout=timeout
            )
        except Exception as e:
            logger.error("MySQL connection failed", error=str(e))
            raise ConnectionError(f"DATABASE_CONNECTION_ERROR: {str(e)}") from e
        
        # 2. EXECUTE PHASE
        try:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await asyncio.wait_for(
                    cursor.execute(sql),
                    timeout=timeout
                )
                
                rows = await cursor.fetchmany(limit)
                results = [dict(row) for row in rows]
            
            logger.info(
                "MySQL query executed",
                row_count=len(results),
                sql_preview=sql[:100]
            )
            
            return results
            
        finally:
            conn.close()
    
    async def test_connection(self) -> Dict[str, Any]:
        try:
            if self.db_type == "postgresql":
                import asyncpg
                conn = await asyncpg.connect(
                    host=self.connection_details["host"],
                    port=self.connection_details["port"],
                    database=self.connection_details["database"],
                    user=self.connection_details["username"],
                    password=self.connection_details["password"],
                    timeout=5
                )
                await conn.execute("SELECT 1")
                await conn.close()
            else:
                import aiomysql
                conn = await aiomysql.connect(
                    host=self.connection_details["host"],
                    port=self.connection_details["port"],
                    db=self.connection_details["database"],
                    user=self.connection_details["username"],
                    password=self.connection_details["password"],
                    connect_timeout=5
                )
                async with conn.cursor() as cursor:
                    await cursor.execute("SELECT 1")
                conn.close()
            
            return {"success": True, "message": "Connection successful"}
            
        except Exception as e:
            logger.error("Connection test failed", error=str(e))
            return {"success": False, "message": str(e)}
