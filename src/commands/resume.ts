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

    try {
        if (next.includes('engineer')) {
            const state = snapshot.values;
            if (state.strategies && state.strategies.length > 0) {
                this.log(theme.header('\nPAUSED STRATEGIES:'));
                state.strategies.forEach((s: any, i: number) => {
                    this.log(`${i === 0 ? theme.success('  [Primary]') : theme.info('  [Alternative]')} ${theme.value(s.suggestedName)}`);
                    this.log(`  Description: ${s.description}`);
                    if (s.nodes && s.nodes.length > 0) {
                        this.log(`  Proposed Nodes: ${s.nodes.map((n: any) => n.type.split('.').pop()).join(', ')}`);
                    }
                    this.log('');
                });

                const { action } = await (await import('inquirer')).default.prompt([{
                    type: 'list',
                    name: 'action',
                    message: 'How would you like to proceed?',
                    choices: [
                        { name: 'Approve and Generate Workflow', value: 'approve' },
                        { name: 'Provide Feedback / Refine Strategy', value: 'feedback' },
                        { name: 'Exit', value: 'exit' }
                    ]
                }]);

                if (action === 'approve') {
                    this.log(theme.agent("Approve! Resuming..."));
                    await graph.updateState({ configurable: { thread_id: threadId } }, { userFeedback: undefined }, 'engineer');
                } else if (action === 'feedback') {
                    const { feedback } = await (await import('inquirer')).default.prompt([{
                        type: 'input',
                        name: 'feedback',
                        message: 'Enter your feedback/instructions:',
                    }]);
                    await graph.updateState({ configurable: { thread_id: threadId } }, { userFeedback: feedback }, 'engineer');
                } else {
                    return;
                }
            }
        }

        this.log(theme.agent("Resuming..."));
        const result = await resumeAgenticWorkflow(threadId);
        
        if (result.validationStatus === 'passed') {
            this.log(theme.success("Workflow completed successfully!"));
        } else {
            this.log(theme.warn(`Workflow finished with status: ${result.validationStatus}`));
        }
        process.exit(0);
    } catch (error) {
        this.error(`Failed to resume: ${(error as Error).message}`);
    }
  }
}
