import { Args, Command } from '@oclif/core'
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import inquirer from 'inquirer';
import { theme } from '../utils/theme.js';
import { N8nClient } from '../utils/n8nClient.js';
import { ConfigManager } from '../utils/config.js';
import { FixtureManager } from '../utils/fixtureManager.js';

export default class Fixture extends Command {
  static args = {
    action: Args.string({
      description: 'Action to perform (init, capture)',
      required: true,
      options: ['init', 'capture'],
    }),
    workflowId: Args.string({
      description: 'n8n workflow ID (optional — omit to browse and select)',
      required: false,
    }),
  }

  static description = 'Manage n8m workflow fixtures for offline testing'

  static examples = [
    '<%= config.bin %> fixture init abc123       # scaffold an empty fixture template',
    '<%= config.bin %> fixture capture           # browse local files + n8n instance to pick a workflow',
    '<%= config.bin %> fixture capture abc123    # pull latest real execution for a specific workflow ID',
  ]

  async run(): Promise<void> {
    const { args } = await this.parse(Fixture)

    if (args.action === 'init') {
      await this.initFixture(args.workflowId)
    } else if (args.action === 'capture') {
      await this.captureFixture(args.workflowId)
    }
  }

  private async initFixture(workflowId?: string): Promise<void> {
    if (!workflowId) {
      this.log(theme.fail('Usage: n8m fixture init <workflowId>'))
      return
    }

    const fixturesDir = path.join(process.cwd(), '.n8m', 'fixtures')
    const fixturePath = path.join(fixturesDir, `${workflowId}.json`)

    if (existsSync(fixturePath)) {
      const { overwrite } = await inquirer.prompt([{
        type: 'confirm',
        name: 'overwrite',
        message: `Fixture already exists at ${fixturePath}. Overwrite?`,
        default: false,
      }])
      if (!overwrite) {
        this.log(theme.muted('Aborted.'))
        return
      }
    }

    const schemaPath = '../../node_modules/n8m/dist/fixture-schema.json'
    const capturedAt = new Date().toISOString()

    const template = {
      $schema: schemaPath,
      version: '1.0',
      capturedAt,
      workflowId,
      workflowName: 'My Workflow',
      workflow: {
        name: 'My Workflow',
        nodes: [],
        connections: {},
      },
      execution: {
        status: 'success',
        data: {
          resultData: {
            error: null,
            runData: {
              'Your Node Name': [
                { json: { key: 'value' } },
              ],
            },
          },
        },
      },
    }

    await fs.mkdir(fixturesDir, { recursive: true })
    await fs.writeFile(fixturePath, JSON.stringify(template, null, 2), 'utf-8')

    this.log(theme.success(`Created ${fixturePath}`))
    this.log('')
    this.log(theme.muted('  Fill in each node\'s output under execution.data.resultData.runData.'))
    this.log(theme.muted('  Keys must match exact node names in your workflow.'))
    this.log('')
    this.log(theme.muted('  To test with this fixture:'))
    this.log(theme.muted(`    n8m test --fixture ${fixturePath}`))
    this.log(theme.muted(`  Or n8m will auto-detect it when you run: n8m test (workflow ID: ${workflowId})`))
  }

  private async captureFixture(workflowId?: string): Promise<void> {
    const config = await ConfigManager.load()
    const n8nUrl = config.n8nUrl ?? process.env.N8N_API_URL
    const n8nKey = config.n8nKey ?? process.env.N8N_API_KEY

    if (!n8nUrl || !n8nKey) {
      this.log(theme.fail('n8n instance not configured. Run: n8m config --n8n-url <url> --n8n-key <key>'))
      return
    }

    const client = new N8nClient({ apiUrl: n8nUrl, apiKey: n8nKey })

    // If no workflowId provided, show interactive picker (local + remote)
    let resolvedId = workflowId
    let resolvedName: string | undefined

    if (!resolvedId) {
      this.log(theme.info('Searching for local and remote workflows...'))

      const localChoices: any[] = []
      const workflowsDir = path.join(process.cwd(), 'workflows')
      const searchDirs = [workflowsDir, process.cwd()]

      for (const dir of searchDirs) {
        if (existsSync(dir)) {
          const files = await fs.readdir(dir)
          for (const file of files) {
            if (file.endsWith('.json')) {
              try {
                const raw = await fs.readFile(path.join(dir, file), 'utf-8')
                const parsed = JSON.parse(raw)
                if (parsed.id) {
                  localChoices.push({
                    name: `${theme.value('[LOCAL]')} ${parsed.name ?? file} (${parsed.id})`,
                    value: { type: 'local', id: parsed.id, name: parsed.name ?? file },
                  })
                }
              } catch {
                // skip unparseable files
              }
            }
          }
        }
      }

      let remoteChoices: any[] = []
      try {
        const remoteWorkflows = await client.getWorkflows()
        remoteChoices = remoteWorkflows
          .filter((w: any) => !w.name.startsWith('[TEST'))
          .map((w: any) => ({
            name: `${theme.info('[n8n]')} ${w.name} (${w.id})${w.active ? ' [Active]' : ''}`,
            value: { type: 'remote', id: w.id, name: w.name },
          }))
      } catch (e) {
        this.log(theme.warn(`Could not fetch remote workflows: ${(e as Error).message}`))
      }

      const choices = [
        ...(localChoices.length > 0 ? [new inquirer.Separator('--- Local Files ---'), ...localChoices] : []),
        ...(remoteChoices.length > 0 ? [new inquirer.Separator('--- n8n Instance ---'), ...remoteChoices] : []),
      ]

      if (choices.length === 0) {
        this.log(theme.fail('No workflows found locally or on your n8n instance.'))
        return
      }

      const { selection } = await inquirer.prompt([{
        type: 'select',
        name: 'selection',
        message: 'Select a workflow to capture:',
        choices,
        pageSize: 15,
      }])

      resolvedId = selection.id
      resolvedName = selection.name
    }

    if (!resolvedId) return

    this.log(theme.agent(`Fetching workflow ${resolvedId} from n8n...`))

    let workflow: any
    try {
      workflow = await client.getWorkflow(resolvedId)
    } catch (e) {
      this.log(theme.fail(`Could not fetch workflow: ${(e as Error).message}`))
      return
    }

    resolvedName = resolvedName ?? (workflow as any).name ?? resolvedId

    this.log(theme.agent(`Fetching most recent execution...`))

    let executions: any[]
    try {
      executions = await client.getWorkflowExecutions(resolvedId)
    } catch (e) {
      this.log(theme.fail(`Could not fetch executions: ${(e as Error).message}`))
      return
    }

    if (!executions?.length) {
      this.log(theme.warn('No executions found for this workflow. Run it in n8n first, then capture.'))
      return
    }

    const latest = executions[0]
    this.log(theme.muted(`  Found execution ${latest.id} (${latest.status}, ${latest.startedAt})`))

    let fullExec: any
    try {
      fullExec = await client.getExecution(latest.id)
    } catch (e) {
      this.log(theme.fail(`Could not fetch execution data: ${(e as Error).message}`))
      return
    }

    const fixtureManager = new FixtureManager()
    const fixturePath = path.join(process.cwd(), '.n8m', 'fixtures', `${resolvedId}.json`)

    if (existsSync(fixturePath)) {
      const { overwrite } = await inquirer.prompt([{
        type: 'confirm',
        name: 'overwrite',
        message: `Fixture already exists for workflow ${resolvedId}. Overwrite?`,
        default: true,
      }])
      if (!overwrite) {
        this.log(theme.muted('Aborted.'))
        return
      }
    }

    await fixtureManager.save({
      version: '1.0',
      capturedAt: new Date().toISOString(),
      workflowId: resolvedId,
      workflowName: resolvedName ?? resolvedId,
      workflow,
      execution: {
        id: fullExec.id,
        status: fullExec.status,
        startedAt: fullExec.startedAt,
        data: {
          resultData: {
            error: fullExec.data?.resultData?.error ?? null,
            runData: fullExec.data?.resultData?.runData ?? {},
          },
        },
      },
    })

    const nodeCount = Object.keys(fullExec.data?.resultData?.runData ?? {}).length
    this.log(theme.success(`Fixture saved to .n8m/fixtures/${resolvedId}.json`))
    this.log(theme.muted(`  Workflow: ${resolvedName}`))
    this.log(theme.muted(`  Execution: ${fullExec.status} · ${nodeCount} node(s) captured`))
    this.log('')
    this.log(theme.muted('  To test with this fixture:'))
    this.log(theme.muted(`    n8m test --fixture .n8m/fixtures/${resolvedId}.json`))
    this.log(theme.muted(`  Or just run: n8m test  (auto-detected by workflow ID)`))
  }
}
