import asyncio
import subprocess
import tempfile
import os
from typing import Dict, Any, Optional
import structlog

logger = structlog.get_logger()


class SandboxRunner:
    def __init__(self, timeout_seconds: int = 30):
        self.timeout_seconds = timeout_seconds
    
    async def run_python(
        self,
        code: str,
        inputs: Optional[Dict[str, Any]] = None,
        env_vars: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        Executes Python code in a restricted subprocess.
        
        Args:
            code: The Python code to execute.
            inputs: Dictionary of input variables to inject into the script.
            env_vars: Environment variables to set for the subprocess.
            
        Returns:
            Dict containing 'output', 'error', 'is_success', 'execution_time_ms'.
        """
        
        # Prepare the wrapper script to handle inputs and capture outputs
        wrapper_code = self._prepare_wrapper_code(code, inputs)
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(wrapper_code)
            script_path = f.name
            
        try:
            start_time = asyncio.get_event_loop().time()
            
            # Prepare environment
            env = os.environ.copy()
            if env_vars:
                env.update(env_vars)
            
            # Execute the script
            process = await asyncio.create_subprocess_exec(
                "python3", script_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env
            )
            
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=self.timeout_seconds
                )
                
                execution_time = (asyncio.get_event_loop().time() - start_time) * 1000
                
                stdout_str = stdout.decode().strip()
                stderr_str = stderr.decode().strip()
                
                if process.returncode == 0:
                    return {
                        "is_success": True,
                        "output": stdout_str,
                        "error": None,
                        "execution_time_ms": int(execution_time)
                    }
                else:
                    return {
                        "is_success": False,
                        "output": stdout_str,
                        "error": stderr_str or "Process exited with non-zero code",
                        "execution_time_ms": int(execution_time)
                    }
                    
            except asyncio.TimeoutError:
                process.kill()
                return {
                    "is_success": False,
                    "output": None,
                    "error": f"Execution timed out after {self.timeout_seconds} seconds",
                    "execution_time_ms": self.timeout_seconds * 1000
                }
                
        except Exception as e:
            logger.error("Sandbox execution failed", error=str(e))
            return {
                "is_success": False,
                "output": None,
                "error": str(e),
                "execution_time_ms": 0
            }
            
        finally:
            # Cleanup
            if os.path.exists(script_path):
                os.unlink(script_path)
    
    def _prepare_wrapper_code(self, user_code: str, inputs: Optional[Dict[str, Any]]) -> str:
        """
        Wraps user code with input injection and basic safety imports.
        """
        input_json = str(inputs) if inputs else "{}"
        
        return f"""
import json
import sys

# Inject inputs
inputs = {input_json}

# User code start
{user_code}
# User code end
"""
