import { AIService } from "../../services/ai.service.js";
import { TeamState } from "../state.js";

export const architectNode = async (state: typeof TeamState.State) => {
  const aiService = AIService.getInstance();
  
  if (!state.userGoal) {
    throw new Error("User goal is missing from state.");
  }

  // Pass-through if we already have a workflow (Repairs/Testing mode)
  // BUT if we have a goal that implies modification, we should probably still generate a spec?
  // For now, let's allow spec generation even if workflowJson exists, so the Engineer can use the spec + old workflow to make new one.
  // The logic in Architect assumes "generateSpec" creates a NEW spec from scratch.
  // We might need a "modifySpec" or just rely on the Engineer to interpret the goal + existing workflow.
  
  // If we skip the architect, we go straight to Engineer?
  // The graph edges are: START -> architect -> engineer.
  // If we return empty here, 'spec' is undefined in state.
  // Engineer checks state.spec.
  
  // If we want to support modification, the Architect should probably analyze the request vs the current workflow.
  // However, for the first MVP, if we return empty, the Engineer will run.
  // Does Engineer handle "no spec" but "has workflowJson" + "userGoal"?
  // Let's assume we want the Architect to generate a plan (Spec) for the modification.
  
  // So we REMOVE this early return, or condition it on "isRepair" vs "isModify".
  // Since we don't have an explicit flag, we can just let it run.
  // The prompt for generateSpec might need to know about the existing workflow?
  // Currently generateSpec only sees the goal.
  
  // Let's comment it out for now to allow Architect to run.
  // if (state.workflowJson) {
  //     return {};
  // }

  try {
    const spec = await aiService.generateSpec(state.userGoal);
    
    // Check if the spec requires clarification
    const questions = spec.questions;
    const needsClarification = questions && questions.length > 0;
    
    // For parallelism, we can create a secondary "Alternative" strategy
    // In a real scenario, the LLM would generate these explicitly.
    // Here we simulate it by wrapping the single spec into a strategy list.
    const strategies = [
        { ...spec, name: "Primary Strategy" },
        // We could ask AI for an alternative here, but for now let's keep it simple to save tokens
        // { ...spec, name: "Alternative Strategy (Robust)" } 
    ];

    return {
      spec, // Keep backward compatibility for single-path
      strategies,
      needsClarification,
    };
  } catch (error) {
    console.error("Architect failed:", error);
    throw error;
  }
};
