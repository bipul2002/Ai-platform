from typing import Dict, Any, List, Optional
import asyncio
import structlog

logger = structlog.get_logger()


class SchemaCrawler:
    def __init__(self, connection_details: Dict[str, Any]):
        self.connection_details = connection_details
        self.db_type = connection_details.get("dbType", "postgresql")
    
    async def crawl(
        self,
        include_schemas: List[str] = None,
        exclude_schemas: List[str] = None,
        include_row_counts: bool = True,
        include_sample_values: bool = False
    ) -> Dict[str, Any]:
        if self.db_type == "postgresql":
            return await self._crawl_postgres(
                include_schemas,
                exclude_schemas,
                include_row_counts,
                include_sample_values
            )
        elif self.db_type == "mysql":
            return await self._crawl_mysql(
                include_schemas,
                exclude_schemas,
                include_row_counts,
                include_sample_values
            )
        else:
            raise ValueError(f"Unsupported database type: {self.db_type}")
    
    async def _crawl_postgres(
        self,
        include_schemas: List[str],
        exclude_schemas: List[str],
        include_row_counts: bool,
        include_sample_values: bool
    ) -> Dict[str, Any]:
        import asyncpg
        
        conn = await asyncpg.connect(
            host=self.connection_details["host"],
            port=self.connection_details["port"],
            database=self.connection_details["database"],
            user=self.connection_details["username"],
            password=self.connection_details["password"]
        )
        
        try:
            exclude_schemas = exclude_schemas or ["pg_catalog", "information_schema", "pg_toast"]
            
            schema_filter = ""
            if include_schemas:
                schemas_str = ", ".join([f"'{s}'" for s in include_schemas])
                schema_filter = f"AND t.table_schema IN ({schemas_str})"
            elif exclude_schemas:
                schemas_str = ", ".join([f"'{s}'" for s in exclude_schemas])
                schema_filter = f"AND t.table_schema NOT IN ({schemas_str})"
            
            tables_query = f"""
                SELECT 
                    t.table_schema,
                    t.table_name,
                    obj_description(c.oid) as comment,
                    COALESCE(c.reltuples::bigint, 0) as row_count
                FROM information_schema.tables t
                LEFT JOIN pg_class c ON c.relname = t.table_name
                LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
                WHERE t.table_type = 'BASE TABLE'
                {schema_filter}
                ORDER BY t.table_schema, t.table_name
            """
            
            tables_result = await conn.fetch(tables_query)
            
            schema_data = {"tables": [], "relationships": []}
            
            for table_row in tables_result:
                table_name = table_row["table_name"]
                table_schema = table_row["table_schema"]
                
                columns_query = """
                    SELECT 
                        c.column_name,
                        c.data_type,
                        c.is_nullable,
                        c.column_default,
                        col_description(t.oid, c.ordinal_position) as comment,
                        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
                        CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END as is_foreign_key,
                        CASE WHEN uq.column_name IS NOT NULL THEN true ELSE false END as is_unique
                    FROM information_schema.columns c
                    LEFT JOIN pg_class t ON t.relname = c.table_name
                    LEFT JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = c.table_schema
                    LEFT JOIN (
                        SELECT ku.column_name, ku.table_name, ku.table_schema
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
                        WHERE tc.constraint_type = 'PRIMARY KEY'
                    ) pk ON pk.column_name = c.column_name AND pk.table_name = c.table_name AND pk.table_schema = c.table_schema
                    LEFT JOIN (
                        SELECT ku.column_name, ku.table_name, ku.table_schema
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
                        WHERE tc.constraint_type = 'FOREIGN KEY'
                    ) fk ON fk.column_name = c.column_name AND fk.table_name = c.table_name AND fk.table_schema = c.table_schema
                    LEFT JOIN (
                        SELECT ku.column_name, ku.table_name, ku.table_schema
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
                        WHERE tc.constraint_type = 'UNIQUE'
                    ) uq ON uq.column_name = c.column_name AND uq.table_name = c.table_name AND uq.table_schema = c.table_schema
                    WHERE c.table_name = $1 AND c.table_schema = $2
                    ORDER BY c.ordinal_position
                """
                
                columns_result = await conn.fetch(columns_query, table_name, table_schema)
                
                columns = []
                for col in columns_result:
                    column_data = {
                        "name": col["column_name"],
                        "type": col["data_type"],
                        "nullable": col["is_nullable"] == "YES",
                        "defaultValue": col["column_default"],
                        "comment": col["comment"],
                        "isPrimaryKey": col["is_primary_key"],
                        "isForeignKey": col["is_foreign_key"],
                        "isUnique": col["is_unique"],
                        "isIndexed": col["is_primary_key"] or col["is_unique"]
                    }
                    
                    if include_sample_values and not col["is_primary_key"]:
                        try:
                            sample_query = f"""
                                SELECT DISTINCT "{col['column_name']}"::text 
                                FROM "{table_schema}"."{table_name}" 
                                WHERE "{col['column_name']}" IS NOT NULL 
                                LIMIT 5
                            """
                            samples = await conn.fetch(sample_query)
                            column_data["sampleValues"] = [str(s[0]) for s in samples]
                        except:
                            pass
                    
                    columns.append(column_data)
                
                schema_data["tables"].append({
                    "name": table_name,
                    "schema": table_schema,
                    "comment": table_row["comment"],
                    "rowCount": table_row["row_count"] if include_row_counts else None,
                    "columns": columns
                })
            
            fk_query = """
                SELECT
                    tc.table_name as source_table,
                    kcu.column_name as source_column,
                    ccu.table_name as target_table,
                    ccu.column_name as target_column,
                    tc.constraint_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
                JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY'
            """
            
            fk_result = await conn.fetch(fk_query)
            
            for fk in fk_result:
                schema_data["relationships"].append({
                    "sourceTable": fk["source_table"],
                    "sourceColumn": fk["source_column"],
                    "targetTable": fk["target_table"],
                    "targetColumn": fk["target_column"],
                    "type": "foreign_key",
                    "constraintName": fk["constraint_name"]
                })
            
            logger.info(
                "Schema crawled",
                db_type="postgresql",
                table_count=len(schema_data["tables"]),
                relationship_count=len(schema_data["relationships"])
            )
            
            return schema_data
            
        finally:
            await conn.close()
    
    async def _crawl_mysql(
        self,
        include_schemas: List[str],
        exclude_schemas: List[str],
        include_row_counts: bool,
        include_sample_values: bool
    ) -> Dict[str, Any]:
        import aiomysql
        
        conn = await aiomysql.connect(
            host=self.connection_details["host"],
            port=self.connection_details["port"],
            db=self.connection_details["database"],
            user=self.connection_details["username"],
            password=self.connection_details["password"]
        )
        
        try:
            database = self.connection_details["database"]
            
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("""
                    SELECT 
                        TABLE_NAME as table_name,
                        TABLE_SCHEMA as table_schema,
                        TABLE_COMMENT as comment,
                        TABLE_ROWS as row_count
                    FROM information_schema.tables
                    WHERE TABLE_SCHEMA = %s AND TABLE_TYPE = 'BASE TABLE'
                    ORDER BY TABLE_NAME
                """, (database,))
                
                tables_result = await cursor.fetchall()
                
                schema_data = {"tables": [], "relationships": []}
                
                for table_row in tables_result:
                    await cursor.execute("""
                        SELECT 
                            COLUMN_NAME as column_name,
                            DATA_TYPE as data_type,
                            IS_NULLABLE as is_nullable,
                            COLUMN_DEFAULT as column_default,
                            COLUMN_COMMENT as comment,
                            COLUMN_KEY as column_key
                        FROM information_schema.columns
                        WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
                        ORDER BY ORDINAL_POSITION
                    """, (database, table_row["table_name"]))
                    
                    columns_result = await cursor.fetchall()
                    
                    columns = []
                    for col in columns_result:
                        columns.append({
                            "name": col["column_name"],
                            "type": col["data_type"],
                            "nullable": col["is_nullable"] == "YES",
                            "defaultValue": col["column_default"],
                            "comment": col["comment"],
                            "isPrimaryKey": col["column_key"] == "PRI",
                            "isForeignKey": col["column_key"] == "MUL",
                            "isUnique": col["column_key"] == "UNI",
                            "isIndexed": col["column_key"] != ""
                        })
                    
                    schema_data["tables"].append({
                        "name": table_row["table_name"],
                        "schema": table_row["table_schema"],
                        "comment": table_row["comment"],
                        "rowCount": table_row["row_count"] if include_row_counts else None,
                        "columns": columns
                    })
                
                await cursor.execute("""
                    SELECT
                        TABLE_NAME as source_table,
                        COLUMN_NAME as source_column,
                        REFERENCED_TABLE_NAME as target_table,
                        REFERENCED_COLUMN_NAME as target_column,
                        CONSTRAINT_NAME as constraint_name
                    FROM information_schema.KEY_COLUMN_USAGE
                    WHERE TABLE_SCHEMA = %s AND REFERENCED_TABLE_NAME IS NOT NULL
                """, (database,))
                
                fk_result = await cursor.fetchall()
                
                for fk in fk_result:
                    schema_data["relationships"].append({
                        "sourceTable": fk["source_table"],
                        "sourceColumn": fk["source_column"],
                        "targetTable": fk["target_table"],
                        "targetColumn": fk["target_column"],
                        "type": "foreign_key",
                        "constraintName": fk["constraint_name"]
                    })
            
            logger.info(
                "Schema crawled",
                db_type="mysql",
                table_count=len(schema_data["tables"]),
                relationship_count=len(schema_data["relationships"])
            )
            
            return schema_data
            
        finally:
            conn.close()
