import vm from 'vm';
import { theme } from './theme.js';

/**
 * Sandboxed Execution Environment for Dynamic Tools
 * Allows agents to write and run temporary analysis scripts.
 */
export class Sandbox {
    /**
     * Run a snippet of JavaScript code safely
     * @param code The code to execute
     * @param context External variables to expose to the script
     * @returns The result of the execution
     */
    static run(code: string, context: Record<string, any> = {}): any {
        const sandbox = {
            console: {
                log: (...args: any[]) => console.log(theme.muted('[Sandbox]'), ...args),
                error: (...args: any[]) => console.error(theme.error('[Sandbox Error]'), ...args)
            },
            ...context
        };

        const script = new vm.Script(code);
        const vmContext = vm.createContext(sandbox);

        try {
            console.log(theme.agent(`Running Dynamic Tool Script (${code.length} bytes)...`));
            const result = script.runInContext(vmContext, { timeout: 5000 }); // 5s timeout
            return result;
        } catch (error) {
            console.error(theme.error(`Sandbox Execution Failed: ${(error as Error).message}`));
            throw error;
        }
    }
}
