import { BaseMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";

export const TeamState = Annotation.Root({
  userGoal: Annotation<string>,
  spec: Annotation<any>,
  workflowJson: Annotation<any>,
  validationErrors: Annotation<string[]>,
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  needsClarification: Annotation<boolean>,
  validationStatus: Annotation<'passed' | 'failed'>,
  availableNodeTypes: Annotation<string[]>,
  revisionCount: Annotation<number>,
  // Parallel Execution Support
  strategies: Annotation<any[]>,
  candidates: Annotation<any[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  // Dynamic Tools
  customTools: Annotation<Record<string, string>>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),
  // Collaboration Log: agents record their reasoning for visibility
  collaborationLog: Annotation<string[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
});
