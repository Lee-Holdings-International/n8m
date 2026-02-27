import { AIService } from "../../services/ai.service.js";
import { TeamState } from "../state.js";
import { NodeDefinitionsService } from "../../services/node-definitions.service.js";
import { jsonrepair } from "jsonrepair";

export const engineerNode = async (state: typeof TeamState.State) => {
  const aiService = AIService.getInstance();

  // RAG: Load and Search Node Definitions
  const nodeService = NodeDefinitionsService.getInstance();
  await nodeService.loadDefinitions();
  
  // Extract keywords from goal + spec
  const queryText = (state.userGoal + (state.spec ? ` ${state.spec.suggestedName} ${state.spec.description}` : "")).replace(/\n/g, " ");
  
  // Search for relevant nodes (limit 8 to save context)
  const relevantDefs = nodeService.search(queryText, 8);
  const staticRef = nodeService.getStaticReference();
  
  const ragContext = (relevantDefs.length > 0 || staticRef)
      ? `\n\n[N8N NODE REFERENCE GUIDE]\n${staticRef}\n\n[AVAILABLE NODE SCHEMAS - USE THESE EXACT PARAMETERS]\n${nodeService.formatForLLM(relevantDefs)}` 
      : "";

  if (relevantDefs.length > 0) {
      console.log(`[Engineer] RAG: Found ${relevantDefs.length} relevant node schemas.`);
  }

  // Self-Correction Loop Check
  if (state.validationErrors && state.validationErrors.length > 0) {
      console.log("🔧 Engineer is fixing the workflow based on QA feedback...");
      
      try {
          // We pass the entire list of errors as context
          const errorContext = state.validationErrors.join('\n');
          
          // Use the robust fix logic from AIService
          const fixedWorkflow = await aiService.generateWorkflowFix(
              state.workflowJson,
              errorContext,
              state.spec?.aiModel, // Pass model if available
              false,
              state.availableNodeTypes || []
          );
          
          return {
              workflowJson: fixedWorkflow,
              // validationErrors will be overwritten by next QA run
          };
      } catch (error) {
          console.error("Engineer failed to fix workflow:", error);
          throw error;
      }
  }

  // Pass-through if workflow exists and no errors (Initial pass for existing workflow)
  if (state.workflowJson) {
      return {};
  }

  // Standard Creation Flow
  // console.log("⚙️  Engineer is building the workflow...");
  
  if (!state.spec) {
    throw new Error("Workflow specification is missing.");
  }

  try {
    const prompt = `You are an n8n Workflow Engineer.
       Generate the valid n8n workflow JSON(s) based on the following approved Specification.
       
       Specification:
       ${JSON.stringify(state.spec, null, 2)}
       ${ragContext}
       
       IMPORTANT:
       1. Desciptive Naming: Name nodes descriptively (e.g. "Fetch Bitcoin Price" instead of "HTTP Request").
       2. Multi-Workflow: If the spec requires multiple workflows (e.g. Main + Sub-workflow), generate them all.
       3. Linking: If one workflow calls another (using an 'Execute Workflow' node), use the "suggestedName" of the target workflow as the 'workflowId' parameter value. Do NOT use generic IDs like "SUBWORKFLOW_ID".
       4. Consistency: Ensure the "name" field in each workflow matches one of the suggestedNames from the spec.
       5. Standard Node Types: Use valid n8n-nodes-base types. 
          - Use "n8n-nodes-base.rssFeedRead" for RSS reading (NOT "rssFeed").
          - Use "n8n-nodes-base.httpRequest" for API calls.
          - Use "n8n-nodes-base.openAi" for OpenAI.
          - Use "n8n-nodes-base.googleGemini" for Google Gemini.
          - Use "n8n-nodes-base.htmlExtract" for HTML/Cheerio extraction.
       6. Connections Structure: The "connections" object keys MUST BE THE SOURCE NODE NAME. The "node" field inside the connection array MUST BE THE TARGET NODE NAME.
       7. Connection Nesting: Ensure the correct n8n connection structure: "SourceNodeName": { "main": [ [ { "node": "TargetNodeName", "type": "main", "index": 0 } ] ] }.

       Output a JSON object with this structure:
       {
          "workflows": [
              { "name": "Workflow Name", "nodes": [...], "connections": {...} }
          ]
       }
       
       Output ONLY valid JSON. No commentary. No markdown.
       `;

    // Using AIService just for the LLM call to keep auth logic dry
    const response = await aiService.generateContent(prompt, {
        provider: state.spec.aiProvider,
        model: state.spec.aiModel
    });
    let cleanJson = response || "{}";
    cleanJson = cleanJson.replace(/```json\n?|\n?```/g, "").trim();

    let result;
    try {
      result = JSON.parse(jsonrepair(cleanJson));
    } catch (e2) {
      console.error("Failed to parse workflow JSON from spec", e2);
      throw new Error("AI generated invalid JSON for workflow from spec");
    }

    if (result.workflows && Array.isArray(result.workflows)) {
      result.workflows = result.workflows.map((wf: any) => aiService.fixHallucinatedNodes(wf));
    }

    return {
      // Only push to candidates — the Supervisor sets workflowJson after fan-in.
      // Writing workflowJson here would cause a LastValue conflict when two
      // Engineers run in parallel via Send().
      candidates: [result],
    };

  } catch (error) {
    console.error("Engineer failed:", error);
    throw error;
  }
};

// Local helpers removed, using AIService methods instead.
