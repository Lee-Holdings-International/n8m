import { AIService, buildCredentialContext } from "../../services/ai.service.js";
import { TeamState } from "../state.js";
import { NodeDefinitionsService } from "../../services/node-definitions.service.js";
import { jsonrepair } from "jsonrepair";
import { theme } from "../../utils/theme.js";

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
  
  // Search pattern library for proven working examples
  const matchedPatterns = nodeService.searchPatterns(queryText);
  const patternsContext = matchedPatterns.length > 0
      ? `\n\n[PROVEN WORKFLOW PATTERNS - FOLLOW THESE EXACTLY]\n${matchedPatterns.join('\n\n---\n\n')}`
      : "";

  const ragContext = (relevantDefs.length > 0 || staticRef || matchedPatterns.length > 0)
      ? `\n\n[N8N NODE REFERENCE GUIDE]\n${staticRef}\n\n[AVAILABLE NODE SCHEMAS - USE THESE EXACT PARAMETERS]\n${nodeService.formatForLLM(relevantDefs)}${patternsContext}`
      : "";

  // Self-Correction Loop Check
  if (state.validationErrors && state.validationErrors.length > 0) {
      const currentRevision = (state.revisionCount || 0) + 1;
      const maxRevisions = state.maxRevisions || 3;

      if (currentRevision > maxRevisions) {
          console.log(theme.fail(`Max self-healing revisions (${maxRevisions}) reached. Manual intervention required.`));
          return {
              revisionCount: currentRevision,
              validationStatus: 'failed' as const,
              validationErrors: [
                  `Self-healing limit (${maxRevisions} revisions) exceeded. Remaining issues:`,
                  ...state.validationErrors,
              ],
          };
      }

      const errCount = state.validationErrors.length;
      console.log(theme.agent(`Repairing workflow — revision ${currentRevision}/${maxRevisions} (${errCount} issue${errCount === 1 ? '' : 's'})...`));
      const MAX_SHOWN = 4;
      state.validationErrors.slice(0, MAX_SHOWN).forEach(e => {
          const truncated = e.length > 110 ? e.substring(0, 110) + '…' : e;
          console.log(theme.muted(`  ↳ ${truncated}`));
      });
      if (errCount > MAX_SHOWN) {
          console.log(theme.muted(`  ↳ +${errCount - MAX_SHOWN} more`));
      }

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
              revisionCount: currentRevision,
              // validationErrors will be overwritten by next QA run
          };
      } catch (error) {
          console.error("Engineer failed to fix workflow:", error);
          throw error;
      }
  }

  // Modification mode: existing workflow + spec from architect
  if (state.workflowJson) {
      if (!state.spec) {
          return {}; // No plan — nothing to do
      }

      const modifiedWorkflow = await aiService.applyModification(
          state.workflowJson,
          state.userGoal,
          state.spec,
          state.userFeedback,
          state.availableNodeTypes || []
      );

      return { workflowJson: modifiedWorkflow };
  }

  // Standard Creation Flow
  // console.log("⚙️  Engineer is building the workflow...");
  
  if (!state.spec) {
    throw new Error("Workflow specification is missing.");
  }

  const credentialContext = buildCredentialContext(state.availableCredentials ?? []);

  try {
    const prompt = `You are an n8n Workflow Engineer.
       Generate the valid n8n workflow JSON(s) based on the following approved Specification.

       Specification:
       ${JSON.stringify(state.spec, null, 2)}
       ${ragContext}
       ${credentialContext}
       ${state.userFeedback ? `\n\nUSER FEEDBACK / REFINEMENTS:\n${state.userFeedback}\n(Incorporate this feedback into the generation process)` : ""}
       
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
       8. Error Connections: In addition to "main", nodes support an "error" output that fires when a node fails. Use this for error handling and cleanup flows. Example:
          "NodeThatMightFail": {
            "main": [ [ { "node": "NextNode", "type": "main", "index": 0 } ] ],
            "error": [ [ { "node": "CleanupOrErrorHandler", "type": "main", "index": 0 } ] ]
          }
          Any node that could fail mid-workflow AND where partial execution would leave side effects (e.g. temporary DB tables, uploaded files, open transactions) MUST have an error connection to a cleanup node.
       9. HTTP Request Configuration: The method determines required fields.
          - GET/DELETE: only "url" (and optional "sendQuery"/"sendHeaders") are needed — do NOT include "sendBody".
          - POST/PUT/PATCH: MUST include "sendBody": true AND a "body" object:
            { "method": "POST", "url": "...", "sendBody": true, "specifyBody": "json", "jsonBody": "={{ JSON.stringify($json) }}" }
          - Authentication: use "authentication": "predefinedCredentialType" + "nodeCredentialType": "<CredentialTypeName>" for service credentials.
          - Minimal config: only include fields relevant to the method. Do not add empty optional fields.
       10. Resource/Operation Nodes (Slack, Google Sheets, Airtable, Gmail, etc.): The "resource" + "operation" pair together determine which parameters are required. Different operations need different fields:
          - post/create operations typically need target identifiers (channel, spreadsheetId, etc.) and content fields.
          - update/patch operations typically need a record ID (messageId, rowId, etc.) and the fields to update.
          - get/list operations typically need filter/search parameters, not content fields.
          Always set both "resource" and "operation" first, then configure only the fields that operation requires.
       11. Credentials Format: Credential references must follow this structure:
          "credentials": { "<credentialTypeName>": { "id": "CREDENTIAL_ID", "name": "Human Readable Name" } }
          Use the exact credential type name that matches the node (e.g. "slackApi", "googleSheetsOAuth2Api", "googleBigQueryOAuth2Api").
          For Google services, prefer service account credentials over OAuth2 when available:
          - BigQuery: use "googleApi" (service account) instead of "googleBigQueryOAuth2Api"
          - Google Sheets: use "googleSheetsServiceAccountApi" instead of "googleSheetsOAuth2Api"
          - Google Drive: use "googleDriveServiceAccountApi" instead of "googleDriveOAuth2Api"
          - Other Google nodes: check if a service account variant exists (typically named "<serviceName>ServiceAccountApi")

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
      result.workflows = result.workflows.map((wf: any) => aiService.wireOrphanedErrorHandlers(aiService.fixHallucinatedNodes(wf)));
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
