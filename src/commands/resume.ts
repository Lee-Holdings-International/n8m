import {Args, Command} from '@oclif/core'
import { theme } from '../utils/theme.js';
import { resumeAgenticWorkflow, graph } from '../agentic/graph.js';

export default class Resume extends Command {
  static args = {
    threadId: Args.string({
      description: 'The Thread ID of the session to resume',
      required: true,
    }),
  }

  static description = 'Resume a paused/interrupted agentic workflow'

  async run(): Promise<void> {
    const {args} = await this.parse(Resume);
    const threadId = args.threadId;

    this.log(theme.brand());
    this.log(theme.header(`RESUMING SESSION: ${threadId}`));

    const snapshot = await graph.getState({ configurable: { thread_id: threadId } });
    const next = snapshot.next;

    if (next.length === 0) {
        this.log(theme.warn("This session is already completed or does not exist."));
        return;
    }

    this.log(theme.info(`Workflow is paused at: ${next.join(', ')}`));
    this.log(theme.agent("Resuming..."));

    try {
        const result = await resumeAgenticWorkflow(threadId);
        
        if (result.validationStatus === 'passed') {
            this.log(theme.success("Workflow completed successfully!"));
        } else {
            this.log(theme.warn(`Workflow finished with status: ${result.validationStatus}`));
        }
    } catch (error) {
        this.error(`Failed to resume: ${(error as Error).message}`);
    }
  }
}
