import { StateGraph, START, END } from "@langchain/langgraph";
import { checkpointer } from "./checkpointer.js";
import { architectNode } from "./nodes/architect.js";
import { engineerNode } from "./nodes/engineer.js";
import { qaNode } from "./nodes/qa.js";
import { reviewerNode } from "./nodes/reviewer.js";
import { supervisorNode } from "./nodes/supervisor.js";
import { TeamState } from "./state.js";

// Define the graph
const workflow = new StateGraph(TeamState)
   .addNode("architect", architectNode)
  .addNode("engineer", engineerNode)
  .addNode("reviewer", reviewerNode)
  .addNode("supervisor", supervisorNode)
  .addNode("qa", qaNode)
  
  // Edges
  .addEdge(START, "architect")
  
  // Architect -> Engineer (spec is chosen interactively in create.ts before resuming)
  .addEdge("architect", "engineer")
  
  // Fan-In: Engineer -> Supervisor (Wait for all to finish) or route to Reviewer (if fixing)
  .addConditionalEdges("engineer", (state) => {
      // If we have errors, we are in "Repair Mode" -> Skip Supervisor (which only handles fresh candidates)
      if (state.validationErrors && state.validationErrors.length > 0) {
          return "reviewer";
      }
      return "supervisor";
  }, ["supervisor", "reviewer"]) // Declare destinations
  
  // Supervisor -> Reviewer
  .addEdge("supervisor", "reviewer")
  
  // Reviewer Logic: Pass -> QA, Fail -> Engineer
  .addConditionalEdges(
      "reviewer",
      (state) => state.validationStatus === "passed" ? "passed" : "failed",
      {
          passed: "qa",
          failed: "engineer"
      }
  )
  
  // Self-Correction Loop
  .addConditionalEdges(
    "qa",
    (state) => {
      // If validation passed, we are done
      if (state.validationStatus === "passed") {
        return "passed";
      }
      // If failed, loop back to engineer to fix
      return "failed";
    },
    {
      passed: END,
      failed: "engineer",
    }
  );

// Compile the graph with persistence and interrupts
export const graph = workflow.compile({
  checkpointer: checkpointer,
  interruptBefore: ["engineer", "qa"], 
});

/**
 * Run the Agentic Workflow
 * @param goal The user's goal string
 * @param initialState Optional initial state (e.g. for existing workflows)
 * @returns The final state of the graph
 */
export const runAgenticWorkflow = async (goal: string, initialState: Partial<typeof TeamState.State> = {}, threadId: string = "default_session") => {
  const result = await graph.invoke({
    userGoal: goal,
    messages: [], 
    validationErrors: [],
    revisionCount: 0,
    ...initialState
  }, {
    configurable: { thread_id: threadId }
  });
  
  return result;
};

/**
 * Run the Agentic Workflow with Streaming
 * @param goal The user's goal string
 * @returns AsyncIterable for events
 */
export const runAgenticWorkflowStream = async (goal: string, threadId: string = "default_session") => {
    return await graph.stream({
        userGoal: goal,
        messages: [],
        validationErrors: [],
        revisionCount: 0,
    }, {
        configurable: { thread_id: threadId }
    });
};

/**
 * Resume the Agentic Workflow from an interrupted state
 */
export const resumeAgenticWorkflow = async (threadId: string, input?: any) => {
  return await graph.invoke(input, {
    configurable: { thread_id: threadId }
  });
};
