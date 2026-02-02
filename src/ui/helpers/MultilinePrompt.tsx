import React, { useState } from 'react';
import { Box, Text, render, useApp } from 'ink';
// @ts-ignore
import TextInput from 'ink-text-input';
// @ts-ignore
import { MultilineInput } from 'ink-multiline-input';

interface SmartPromptProps {
  onDone: (value: string) => void;
  title?: string;
}

const SmartPromptElement: React.FC<SmartPromptProps> = ({ onDone, title }) => {
  const [mode, setMode] = useState<'single' | 'multi'>('single');
  const [value, setValue] = useState('');
  const [multiValue, setMultiValue] = useState('');
  const { exit } = useApp();

  const handleSingleSubmit = (text: string) => {
    if (text.trim() === '```') {
      setMode('multi');
    } else if (text.trim().length > 0) {
      onDone(text.trim());
      exit();
    }
    // If empty, do nothing (stays open)
  };

  const handleMultiSubmit = (text: string) => {
    // End with ``` to submit
    if (text.trim().endsWith('```')) {
      const finalValue = text.trim();
      const cleaned = finalValue.slice(0, -3).trim();
      if (cleaned.length > 0) {
        onDone(cleaned);
        exit();
        return;
      }
    }
    // If not ending with ```, we want to add a newline
    // Since we've hijacked Enter for submit, we must manually append the newline
    setMultiValue(text + '\n');
  };

  if (mode === 'single') {
    return (
      <Box>
        <Text color="green">? </Text>
        <Text bold>{title || 'Describe the workflow (use ``` for multiline): '} </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSingleSubmit}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Box>
        <Text color="green">✔ </Text>
        <Text bold>{title || 'Describe the workflow (use ``` for multiline): '} </Text>
        <Text color="cyan">```</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="cyan">Entering multiline mode. Type ``` on a new line to finish.</Text>
      </Box>
      <Box flexDirection="row" marginTop={1}>
        <Text color="gray">┃ </Text>
        <Box flexGrow={1}>
          <MultilineInput
            value={multiValue}
            onChange={setMultiValue}
            onSubmit={handleMultiSubmit}
            rows={5}
            maxRows={15}
            keyBindings={{
                submit: (key: any) => key.return && !key.shift,
                newline: (key: any) => key.return && key.shift
            }}
          />
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Arrows: Navigate | Enter: Submit (if ends with ```) | Shift+Enter: Newline
        </Text>
      </Box>
    </Box>
  );
};

export async function promptMultiline(message?: string): Promise<string> {
  return new Promise((resolve) => {
    let result = '';
    const instance = render(
      <SmartPromptElement
        onDone={(val) => {
          result = val;
        }}
        title={message}
      />
    );
    instance.waitUntilExit().then(() => {
      resolve(result);
    });
  });
}
