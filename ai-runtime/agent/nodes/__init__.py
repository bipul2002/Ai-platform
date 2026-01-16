from agent.nodes.base import BaseNode, QueryState
from agent.nodes.intent import IntentNodes
from agent.nodes.schema import SchemaNodes
from agent.nodes.builder import BuilderNodes
from agent.nodes.validator import ValidatorNodes
from agent.nodes.executor import ExecutorNodes
from agent.nodes.response import ResponseNodes

class QueryGraphNodes(
    IntentNodes,
    SchemaNodes,
    BuilderNodes,
    ValidatorNodes,
    ExecutorNodes,
    ResponseNodes
):
    """
    Main class for query processing nodes.
    Inherits from specialized modular classes to maintain a clean monolithic interface
    internally while being modular in structure.
    """
    def __init__(self, agent_config=None):
        super().__init__(agent_config=agent_config)
