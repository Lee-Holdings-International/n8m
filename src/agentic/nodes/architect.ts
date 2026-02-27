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
    console.log(`[Architect] ${logEntry}`);

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
