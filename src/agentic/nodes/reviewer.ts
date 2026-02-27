import { TeamState } from "../state.js";
import { theme } from "../../utils/theme.js";

export const reviewerNode = async (state: typeof TeamState.State) => {
  const workflowJson = state.workflowJson;
  const validationErrors: string[] = [];

  if (!workflowJson) {
      return { 
          validationStatus: 'failed', 
          validationErrors: ["No workflow JSON found to review."] 
      };
  }

  // Helper to get nodes from potentially nested structure
  let nodes: any[] = [];
  let targetWorkflow = workflowJson;

  if (workflowJson.workflows && Array.isArray(workflowJson.workflows) && workflowJson.workflows.length > 0) {
        targetWorkflow = workflowJson.workflows[0];
  }
  
  if (targetWorkflow.nodes && Array.isArray(targetWorkflow.nodes)) {
      nodes = targetWorkflow.nodes;
  }

  // 1. Check for hallucinated node types
  const knownHallucinations = [
      "rssFeed", "n8n-nodes-base.rssFeed",
      "n8n-nodes-base.gpt", "n8n-nodes-base.openai", "openai",
      "n8n-nodes-base.gemini",
      "cheerioHtml", "n8n-nodes-base.cheerioHtml"
  ];

  nodes.forEach(node => {
      if (knownHallucinations.includes(node.type)) {
          console.log(theme.warn(`[Reviewer] Detected hallucinated node type: ${node.type}`));
          validationErrors.push(`Hallucinated node type detected: "${node.type}". Use standard n8n-nodes-base types.`);
      }
      
      // Check for empty names
      if (!node.name || node.name.trim() === "") {
          validationErrors.push(`Node with type "${node.type}" has an empty name.`);
      }

      // 1.1 Strict Type Check (if available)
      if (state.availableNodeTypes && state.availableNodeTypes.length > 0) {
          if (!state.availableNodeTypes.includes(node.type)) {
               // Double check it's not a known exception or recent core node
               if (!node.type.startsWith('n8n-nodes-base.stick')) { // generic bypass for sticky notes etc if needed
                   console.log(theme.warn(`[Reviewer] Node type not found in instance: ${node.type}`));
                   validationErrors.push(`Node type "${node.type}" is not available on your n8n instance.`);
               }
          }
      }
  });

  // 2. Check for disconnected nodes (Orphans)
  // Build adjacency list (which nodes are destinations?)
  const destinations = new Set<string>();
  const connections = targetWorkflow.connections || {};
  
  for (const sourceNode in connections) {
      const outputConfig = connections[sourceNode];
      // iterate over outputs (main, ai_tool, etc)
      for (const outputType in outputConfig) {
          const routes = outputConfig[outputType];
          routes.forEach((route: any[]) => {
              route.forEach((connection: any) => {
                  if (connection.node) {
                      destinations.add(connection.node);
                  }
              });
          });
      }
  }

  // Iterate nodes to find orphans (non-trigger nodes with no incoming connections)
  // Triggers usually have no input.
  // We use a broader check: any node with "trigger" or "webhook" in the name, plus generic start types.
  const isTrigger = (type: string) => {
      if (!type) return false;
      const lower = type.toLowerCase();
      return lower.includes('trigger') || 
             lower.includes('webhook') || 
             lower.includes('n8n-nodes-base.start') ||
             lower.includes('n8n-nodes-base.poll');
  };

  nodes.forEach(node => {
      // 2.1 Orphan Check
      if (!destinations.has(node.name) && !isTrigger(node.type)) {
           // It's an orphan unless it's a known trigger-like node
           // Sticky notes and Merge nodes can be tricky, but generally Merge needs input.
           if (!node.type.includes('StickyNote')) {
                // Double check for "On Execution" (custom trigger name sometimes used)
                if (!node.name || (!node.name.toLowerCase().includes('trigger') && !node.name.toLowerCase().includes('webhook'))) {
                     console.log(theme.warn(`[Reviewer] Validated disconnection: Node "${node.name || 'Unnamed'}" has no incoming connections.`));
                     validationErrors.push(`Node "${node.name || 'Unnamed'}" (${node.type || 'unknown type'}) is disconnected (orphaned). Connect it or remove it.`);
                }
           }
      }

      // 2.2 Sub-Workflow Validation
      if (node.type === 'n8n-nodes-base.executeWorkflow') {
          const workflowId = node.parameters?.workflowId;
          const mode = node.parameters?.mode || 'id'; // default is often ID
          
          if (!workflowId && mode === 'id') {
               validationErrors.push(`Node "${node.name}" (Execute Workflow) is missing a 'workflowId' parameter.`);
          }
      }
  });
  
  // 3. Credentials Check
  // If we see an OpenAI node, warn if no credential ID is placeholder? (Skip for now)

  if (validationErrors.length > 0) {
      return {
          validationStatus: 'failed',
          validationErrors: validationErrors,
      };
  }

  // console.log(theme.success("Reviewer passed the blueprint."));
  return {
      validationStatus: 'passed',
      // Clear errors from previous runs
      validationErrors: [] 
  };
};
