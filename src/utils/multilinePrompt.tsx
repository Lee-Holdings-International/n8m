import * as readline from 'node:readline';

export async function promptMultiline(message?: string): Promise<string> {
  const label = message || 'Describe the workflow (use ``` for multiline): ';

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    let multilineMode = false;
    const lines: string[] = [];

    process.stdout.write(`\x1b[32m?\x1b[0m \x1b[1m${label}\x1b[0m`);

    const done = (value: string) => {
      rl.close();
      resolve(value);
    };

    rl.on('line', (line) => {
      if (!multilineMode) {
        if (line.trim() === '```') {
          multilineMode = true;
          process.stdout.write(
            `\x1b[36m  Multiline mode — type \`\`\` on its own line to finish.\x1b[0m\n`
          );
        } else if (line.trim().length > 0) {
          done(line.trim());
        }
        // empty line — stay open
      } else {
        if (line.trim() === '```') {
          done(lines.join('\n'));
        } else {
          lines.push(line);
        }
      }
    });
  });
}
