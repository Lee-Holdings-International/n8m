import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput, Static, Spacer } from 'ink';
// @ts-ignore
import { MultilineInput } from 'ink-multiline-input';
import Spinner from 'ink-spinner';
import { theme } from '../../utils/theme.js';
import chalk from 'chalk';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface CreateChatProps {
  initialDescription?: string;
  onFinish: (workflow: any) => void;
  onCancel: () => void;
  processWorkflow?: (workflow: any, log: (msg: string) => void) => Promise<void>;
  aiService: any;
}

export const CreateChat: React.FC<CreateChatProps> = ({
  initialDescription,
  onFinish,
  onCancel,
  processWorkflow,
  aiService
}) => {
  const { exit } = useApp();
  const [view, setView] = useState<'blueprint' | 'console'>('blueprint');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentSpec, setCurrentSpec] = useState<any>(null);
  const [statusMessage, setStatusMessage] = useState<string>('Ready');
  const [showDetails, setShowDetails] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const VIEW_HEIGHT = 15;

  // Custom Input Handling
  useInput((inputStr, key) => {
      // 1. Navigation / Global Shortcuts
      if (view === 'blueprint') {
          // Scrolling
          if (key.pageUp || (key.ctrl && key.upArrow)) {
              setScrollOffset(prev => Math.max(0, prev - 5));
          }
          if (key.pageDown || (key.ctrl && key.downArrow)) {
               setScrollOffset(prev => prev + 5);
          }
          // Note: Up/Down without Ctrl are left to MultilineInput for cursor navigation
          
          // Toggle Details
          if (key.ctrl && inputStr === 'd') {
            setShowDetails(prev => !prev);
          }
      }
  });

  useEffect(() => {
    if (initialDescription) {
        setStatusMessage('Analyzing...');
        handleUserAction(initialDescription);
    } else {
        setStatusMessage('Waiting for input...');
    }
  }, []);

  // ... (No cursor reset needed as MultilineInput handles it internalish or via value)

  const handleUserAction = async (text: string) => {
    if (!text.trim()) return;
    const trimmed = text.trim();
    
    if (trimmed.startsWith('/')) {
        await handleSlashCommand(trimmed);
        setInput('');
        return;
    }

    setInput('');
    setIsProcessing(true);
    setStatusMessage('Architecting...');

    try {
        if (!currentSpec) {
          const spec = await aiService.generateSpec(text);
          setCurrentSpec(spec);
          setStatusMessage('Blueprint created.');
          addSystemLog(`Drafted: ${text.substring(0,30)}...`);
        } else {
          const refinedSpec = await aiService.refineSpec(currentSpec, text);
          setCurrentSpec(refinedSpec);
          setStatusMessage('Blueprint refined.');
          addSystemLog(`Refined: ${text.substring(0,30)}...`);
        }
    } catch (error) {
      addSystemLog(chalk.red('Error: ') + (error as Error).message);
      setStatusMessage('Error.');
    } finally {
      setIsProcessing(false);
    }
  };

  const addSystemLog = (msg: string) => {
      setMessages(prev => [...prev.slice(-19), { role: 'system', content: msg }]);
  };

  const handleSlashCommand = async (command: string) => {
    const parts = command.split(' ');
    const cmd = parts[0].toLowerCase();
    
    switch (cmd) {
      case '/specify':
      case '/reset':
        setCurrentSpec(null);
        setStatusMessage('Reset.');
        break;
      case '/implement':
      case '/build':
        if (!currentSpec) {
             addSystemLog(chalk.red('Nothing to build.'));
             return;
        }
        setIsProcessing(true);
        setStatusMessage('Building...');
        try {
            const workflow = await aiService.generateWorkflowFromSpec(currentSpec);
            setStatusMessage('Workflow Generated.');
            addSystemLog('Workflow logic synthesized.');

            if (processWorkflow) {
                setView('console');
                setStatusMessage('Executing post-build tasks...');
                await processWorkflow(workflow, (msg) => {
                    setMessages(prev => [...prev.slice(-19), { role: 'system', content: msg.trim() }]);
                });
            }

            setStatusMessage('Done.');
            onFinish(workflow);
            exit();
        } catch (e) {
            addSystemLog(chalk.red('Build failed: ' + (e as Error).message));
            setStatusMessage('Failed.');
            setView('blueprint');
        } finally {
            setIsProcessing(false);
        }
        break;
      case '/exit':
        onCancel();
        exit();
        break;
      case '/help':
        addSystemLog('/reset, /build, /exit');
        break;
      default:
        addSystemLog(chalk.red('Unknown cmd'));
    }
  };

  const BlueprintView = ({ spec, showDetails }: { spec: any, showDetails: boolean }) => {
      if (!spec) {
          return (
              <Box flexDirection="column" alignItems="center" justifyContent="center" height={15}>
                  <Text bold color="magenta">n8m</Text>
                  <Text color="gray" dimColor>Architect</Text>
                  <Spacer />
                  <Box flexDirection="column" alignItems="center" borderStyle="single" borderDimColor borderColor="gray" paddingX={2} paddingY={1}>
                      <Text color="white">Describe your workflow goal.</Text>
                      <Box marginTop={1}>
                        <Text color="gray" italic>e.g. "Check RSS feed every hour and post to Slack"</Text>
                      </Box>
                  </Box>
                  <Spacer />
              </Box>
          );
      }

      return (
          <Box flexDirection="column" paddingX={1} marginTop={1} height="100%" overflow="hidden">
             <Box flexDirection="column" marginTop={-scrollOffset}>
                  <Box marginBottom={1} borderStyle="single" borderDimColor borderColor="gray" paddingX={1} paddingY={0} width="100%">
                      <Box width={10}><Text color="magenta" bold>GOAL</Text></Box>
                      <Box flexGrow={1}><Text bold color="whiteBright">{spec.goal}</Text></Box>
                  </Box>

                  <Box flexDirection="column" paddingX={1}>
                      <Box marginBottom={1}>
                          <Text color="gray" dimColor underline>EXECUTION PLAN</Text>
                      </Box>
                      {(spec.tasks || []).map((t: any, i: number) => {
                          let taskText = "";
                          if (typeof t === 'string') {
                              taskText = t;
                          } else if (typeof t === 'object' && t !== null) {
                              taskText = t.step || t.description || t.task || JSON.stringify(t);
                          }
                          return (
                              <Box key={i} marginBottom={0}>
                                  <Text color="cyan" dimColor>  {i + 1}. </Text>
                                  <Text color="white">{taskText}</Text>
                              </Box>
                          );
                      })}
                  </Box>

                  {showDetails && (
                      <Box flexDirection="column" marginTop={1} marginX={1} borderStyle="round" borderColor="gray" padding={1}>
                          <Text color="green" bold>TOPOLOGY</Text>
                          <Box flexDirection="row" flexWrap="wrap" marginBottom={1}>
                              {(spec.nodes || []).map((n: string, i: number) => (
                                 <Text key={i} color="green" dimColor> {n} <Text color="gray" dimColor>➜</Text></Text>
                              ))}
                              <Text color="green" dimColor> END</Text>
                          </Box>
                          
                          {spec.assumptions?.length > 0 && (
                              <Box flexDirection="column" marginTop={0}>
                                  <Text color="red" dimColor bold>ASSUMPTIONS</Text>
                                  {spec.assumptions.map((a: string, i: number) => (
                                      <Text key={i} color="red" dimColor>  • {a}</Text>
                                  ))}
                              </Box>
                          )}
                      </Box>
                  )}
                  <Box height={5} /> 
             </Box>
          </Box>
      );
  };

  const ConsoleView = () => {
      // ... (same)
      return (
          <Box flexDirection="column" paddingX={1} height="100%" borderStyle="single" borderDimColor borderColor="gray">
              <Box marginBottom={1}>
                  <Text color="gray" dimColor bold>SYSTEM LOGS</Text>
              </Box>
              <Box flexDirection="column">
                  {messages.map((m, i) => (
                      <Text key={i} color={m.content.toLowerCase().includes('error') ? 'red' : 'gray'}>
                          <Text color="gray" dimColor>› </Text>{m.content}
                      </Text>
                  ))}
              </Box>
          </Box>
      );
  };
  
  return (
    <Box flexDirection="column" paddingX={2} height="100%">
      <Box justifyContent="space-between" marginBottom={0} borderStyle="single" borderDimColor borderColor="gray" borderBottom={false} borderTop={false} borderLeft={false} borderRight={false}>
          <Text color="magenta" bold> n8m ARCHITECT</Text>
          <Text color={isProcessing ? 'yellow' : 'green'} dimColor> {isProcessing ? '● Working...' : '● ' + statusMessage} </Text>
      </Box>

      <Box flexGrow={1} flexDirection="column" overflow="hidden">
          {view === 'blueprint' ? <BlueprintView spec={currentSpec} showDetails={showDetails} /> : <ConsoleView />}
      </Box>

      {view === 'blueprint' && (
          <Box flexDirection="column" marginBottom={0} height={1} justifyContent="flex-end">
               {messages.slice(-1).map((m, i) => ( 
                    <Text key={i} color="gray" dimColor italic> ℹ {m.content} </Text>
               ))}
          </Box>
      )}

      {/* Remove minHeight from Box if we want MultilineInput to handle it relative to rows? 
          Actually user said: "Avoid fixed large height on the wrapping <Box>".
          But minHeight={3} should be fine as it's small.
      */}
      <Box flexDirection="row" borderStyle="single" borderColor={isProcessing ? 'yellow' : 'cyan'} paddingX={1} borderDimColor={!isProcessing} minHeight={1}>
          <Box marginRight={1}><Text color={isProcessing ? 'yellow' : 'cyan'}>›</Text></Box>
          <Box flexGrow={1}>
            {!isProcessing && view === 'blueprint' && (
                <MultilineInput
                    value={input}
                    onChange={setInput}
                    onSubmit={handleUserAction}
                    rows={1}
                    maxRows={12}
                    keyBindings={{
                        submit: (key: any) => key.return && !key.shift,
                        newline: (key: any) => key.return && key.shift
                    }}
                    placeholder={currentSpec ? "Refine the plan..." : "Describe a workflow..."}
                />
            )}
            {isProcessing && <Text color="gray" dimColor italic>Thinking...</Text>}
            {!isProcessing && view === 'console' && <Text color="gray" dimColor>Console locked.</Text>}
          </Box>
      </Box>

      <Box marginTop={0} flexDirection="column" alignItems="center">
        <Text color="gray" dimColor>
            {view === 'blueprint' ? (
                <Text>
                    <Text color="white" bold>Enter</Text> Submit <Text color="gray">|</Text> <Text color="white" bold>Shift+Enter</Text> Newline <Text color="gray">|</Text> <Text color="white" bold>PgUp/Dn</Text> Scroll <Text color="gray">|</Text> <Text color="white" bold>Ctrl+D</Text> Details
                </Text>
            ) : (
                <Text>Please wait...</Text>
            )}
        </Text>
        {view === 'blueprint' && (
            <Text color="magenta" dimColor>
                Commands: <Text bold>/build</Text> <Text bold>/reset</Text> <Text bold>/exit</Text> <Text bold>/help</Text>
            </Text>
        )}
      </Box>
    </Box>
  );
};
