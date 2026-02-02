import { AIService } from "../../services/ai.service.js";
import { TeamState } from "../state.js";

export const architectNode = async (state: typeof TeamState.State) => {
  const aiService = AIService.getInstance();
  
  if (!state.userGoal) {
    throw new Error("User goal is missing from state.");
  }

  // Pass-through if we already have a workflow (Repairs/Testing mode)
  if (state.workflowJson) {
      return {};
  }

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
