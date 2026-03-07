import { AIService } from "../../services/ai.service.js";
import { TeamState } from "../state.js";

export const architectNode = async (state: typeof TeamState.State) => {
  const aiService = AIService.getInstance();
  
  if (!state.userGoal) {
    throw new Error("User goal is missing from state.");
  }

  // Validation / repair mode: an existing workflow was supplied.
  // Skip spec generation entirely — the engineer and reviewer operate directly
  // on the existing workflowJson.  Generating a brand-new spec here causes the
  // parallel engineers (via Send) to rebuild the workflow from scratch, which
  // produces very large JSON that is error-prone and throws away the user's work.
  if (state.workflowJson) {
    const plan = await aiService.generateModificationPlan(state.userGoal, state.workflowJson);
    return {
      spec: plan,
      collaborationLog: [`Architect: Modification plan — ${plan.description}`],
    };
  }

  try {
    const spec = await aiService.generateSpec(state.userGoal);

    // Check if the spec requires clarification
    const questions = spec.questions;
    const needsClarification = questions && questions.length > 0;

    // Multi-agent collaboration: generate an alternative strategy in parallel with the primary.
    // Both are handed off to separate Engineer agents that run concurrently.
    const alternativeSpec = await aiService.generateAlternativeSpec(state.userGoal, spec);

    const alternativeModel = aiService.getAlternativeModel();

    const strategies = [
      { 
        ...spec, 
        strategyName: "Primary Strategy", 
        aiModel: aiService.getDefaultModel()
      },
      { 
        ...alternativeSpec, 
        strategyName: "Alternative Strategy", 
        aiModel: alternativeModel
      },
    ];

    const logEntry = `Architect: Generated 2 strategies — "${strategies[0].suggestedName}" (primary) and "${strategies[1].suggestedName}" (alternative)`;

    return {
      spec,
      strategies,
      needsClarification,
      collaborationLog: [logEntry],
    };
  } catch (error) {
    console.error("Architect failed:", error);
    throw error;
  }
};
