import { TeamState } from "../state.js";
import { theme } from "../../utils/theme.js";

export const supervisorNode = async (state: typeof TeamState.State) => {
  const candidates = state.candidates;
  
  if (!candidates || candidates.length === 0) {
      // Fallback: use existing workflowJson if available
      return {};
  }

  console.log(theme.agent(`Supervisor found ${candidates.length} candidates.`));

  // In a real agentic system, we would have an LLM evaluate them.
  // For now, we'll pick the first one (or the one with the most nodes? or custom logic?).
  // Let's simulate "Selection":
  
  const bestCandidate = candidates[0];
  console.log(theme.success(`Supervisor selected: ${bestCandidate.name || "Unnamed Workflow"}`));

  // We set the chosen one as the canonical 'workflowJson' for the rest of the flow (QA, etc)
  return {
      workflowJson: bestCandidate
  };
};
