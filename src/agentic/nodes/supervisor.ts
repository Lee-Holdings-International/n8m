import { AIService } from "../../services/ai.service.js";
import { TeamState } from "../state.js";
import { theme } from "../../utils/theme.js";

export const supervisorNode = async (state: typeof TeamState.State) => {
  const candidates = state.candidates;

  if (!candidates || candidates.length === 0) {
    // Fallback: use existing workflowJson if available
    return {};
  }

  const aiService = AIService.getInstance();
  const evaluation = await aiService.evaluateCandidates(state.userGoal, candidates);

  const bestCandidate = candidates[evaluation.selectedIndex] ?? candidates[0];
  const logEntry = `Supervisor: Selected candidate ${evaluation.selectedIndex + 1}/${candidates.length} ("${bestCandidate.name || 'Unnamed'}"). Reason: ${evaluation.reason}`;

  const displayName = bestCandidate.name || bestCandidate.workflows?.[0]?.name || 'Unnamed Workflow';
  console.log(theme.agent(`Selected: ${displayName}`));

  return {
    workflowJson: bestCandidate,
    collaborationLog: [logEntry],
  };
};
