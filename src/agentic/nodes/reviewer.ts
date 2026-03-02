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

  nodes.filter(Boolean).forEach(node => {
      if (!node.type) {
          validationErrors.push(`A node is missing a "type" property — AI may have generated an incomplete node.`);
          return;
      }

      if (knownHallucinations.includes(node.type)) {
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
                   validationErrors.push(`Node type "${node.type}" is not available on your n8n instance.`);
               }
          }
      }
  });

  // 2. Check for disconnected nodes (Orphans)
  // Build adjacency list (which nodes are destinations?)
  const destinations = new Set<string>();
  const connections = targetWorkflow.connections || {};
  // Nodes that appear as keys in connections have at least one outgoing connection.
  // Sub-nodes (AI models, tools, etc.) connect TO their parent this way — they should
  // never be treated as orphans even though nothing connects back to them.
  const sources = new Set<string>(Object.keys(connections));
  
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

  const orphanedNodes: any[] = [];
  nodes.forEach(node => {
      // 2.1 Orphan Check
      if (!destinations.has(node.name) && !sources.has(node.name) && !isTrigger(node.type)) {
           if (!node.type?.includes('StickyNote')) {
                if (!node.name || (!node.name.toLowerCase().includes('trigger') && !node.name.toLowerCase().includes('webhook'))) {
                     orphanedNodes.push(node);
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

  // 2.3 Auto-Shim: Attempt to chain orphaned nodes rather than failing
  let shimmedWorkflow: any = null;
  if (orphanedNodes.length > 0) {
      const triggerNodes = nodes.filter(n => isTrigger(n.type));
      const actionableOrphans = orphanedNodes.filter(n => !n.type?.includes('StickyNote'));

      // Sort orphans by x position (left-to-right layout order)
      const sorted = [...actionableOrphans].sort((a, b) => (a.position?.[0] ?? 0) - (b.position?.[0] ?? 0));

      // Build a patched connections object
      const patchedConnections = { ...(targetWorkflow.connections || {}) };

      // Find the last node in the existing chain (a source node whose targets don't include any orphan)
      // Simplification: if there's a trigger with no outgoing connections, attach the first orphan to it
      let attachToName: string | null = null;
      if (triggerNodes.length > 0) {
          const trigger = triggerNodes[0];
          if (!patchedConnections[trigger.name]) {
              attachToName = trigger.name;
          } else {
              // Trigger already connects to something — find the tail of its chain
              // Walk the chain and stop at the first node with no outgoing connection
              let current = trigger.name;
              for (let depth = 0; depth < 20; depth++) {
                  const outgoing = patchedConnections[current];
                  if (!outgoing?.main?.[0]?.[0]?.node) break;
                  const next = outgoing.main[0][0].node;
                  if (orphanedNodes.some(o => o.name === next)) break; // avoid infinite loop into orphans
                  current = next;
              }
              attachToName = current;
          }
      }

      if (attachToName && sorted.length > 0) {
          // Attach first orphan to the chain tail
          patchedConnections[attachToName] = {
              main: [[{ node: sorted[0].name, type: 'main', index: 0 }]]
          };
          // Chain remaining orphans linearly
          for (let i = 0; i < sorted.length - 1; i++) {
              patchedConnections[sorted[i].name] = {
                  main: [[{ node: sorted[i + 1].name, type: 'main', index: 0 }]]
              };
          }
          console.log(theme.done(`Auto-connected ${sorted.length} orphaned node(s).`));
          shimmedWorkflow = { ...targetWorkflow, connections: patchedConnections };
          // Don't push these to validationErrors — we fixed them
      } else {
          // Can't determine where to attach — escalate to engineer
          for (const node of actionableOrphans) {
              validationErrors.push(`Node "${node.name || 'Unnamed'}" (${node.type || 'unknown type'}) is disconnected (orphaned). Connect it or remove it.`);
          }
      }
  }

  // 3. Credentials Check
  // If we see an OpenAI node, warn if no credential ID is placeholder? (Skip for now)

  if (validationErrors.length > 0) {
      return {
          validationStatus: 'failed',
          validationErrors: validationErrors,
      };
  }

  // Return the shimmed workflow if we auto-fixed orphaned nodes
  return {
      validationStatus: 'passed',
      validationErrors: [],
      ...(shimmedWorkflow ? { workflowJson: shimmedWorkflow } : {}),
  };
};
