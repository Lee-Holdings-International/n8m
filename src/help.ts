import { Help } from '@oclif/core';
import type { Command } from '@oclif/core';
import { theme } from './utils/theme.js';

export default class CustomHelp extends Help {
  protected async showRootHelp(): Promise<void> {
    this.log(theme.brand());
    await super.showRootHelp();
  }

  async showCommandHelp(command: Command.Loadable): Promise<void> {
    this.log(theme.brand());
    await super.showCommandHelp(command);
  }
}
