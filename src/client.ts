import "dotenv/config";
import { SSEClientTransport } from './sse-client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import OpenAI from 'openai';

// Define types for tools
interface Tool {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

let availableTools: Tool[] = [];

async function processMessage(message: string, client: Client) {
  try {
    // Format tools for OpenAI
    const openAITools = availableTools.map((tool: Tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description || "",
        parameters: {
          type: "object",
          properties: tool.inputSchema.properties || {},
          required: tool.inputSchema.required || []
        }
      }
    }));

    console.log('Formatted tools:', JSON.stringify(openAITools, null, 2));

    // First call to OpenAI to determine which tool to use
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: `You are a helpful assistant that determines which tools to use based on user messages.
          
          Available tools:
          ${openAITools.map((tool) => `
          Tool: ${tool.function.name}
          Description: ${tool.function.description}
          Parameters: ${JSON.stringify(tool.function.parameters, null, 2)}
          `).join('\n')}
          
          When deciding which tool to use, follow these steps:
          1. Analyze the user's request to understand what they need
          2. Match the request to the most appropriate tool
          3. Provide all required parameters
          
          Always respond with a function call that includes:
          - The most appropriate tool for the task
          - All required parameters
          ` 
        },
        { role: "user", content: message }
      ],
      tools: openAITools,
      tool_choice: "auto",
      temperature: 0.7,
    });

    console.log('OpenAI Response:', JSON.stringify(completion, null, 2));

    const toolCall = completion.choices[0].message.tool_calls?.[0];
    if (!toolCall) {
      throw new Error("No tool was selected by the model");
    }

    const toolName = toolCall.function.name;
    const toolArgs = JSON.parse(toolCall.function.arguments);

    console.log('Selected tool:', toolName);
    console.log('Tool arguments:', JSON.stringify(toolArgs, null, 2));

    // Execute the chosen tool
    const result = await client.callTool({
      name: toolName,
      arguments: toolArgs
    });

    // Second call to OpenAI to format the result in a natural way
    const formattedResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant that formats tool execution results into natural language responses.
          Original user message: ${message}
          Tool used: ${toolName}
          Tool arguments: ${JSON.stringify(toolArgs)}
          Tool result: ${JSON.stringify(result)}
          
          Provide a clear, concise, and natural response that:
          1. Answers the user's original question
          2. Provides context about how the result was obtained
          `
        }
      ],
      temperature: 0.7,
    });

    const finalResponse = formattedResponse.choices[0].message.content;
    console.log('Final response:', finalResponse);
    
    return {
      toolUsed: toolName,
      arguments: toolArgs,
      result: result,
      response: finalResponse
    };
  } catch (error) {
    console.error('Error processing message:', error);
    throw error;
  }
}

(async () => {
  try {
    const client = new Client({
      name: "example-client",
      version: "1.0.0"
    }, {
      capabilities: {}
    });
    
    const transport = new SSEClientTransport(
      new URL("http://localhost:3000/sse")
    );

    // Set up event handlers
    transport.onmessage = (message) => {
      console.log('Received message:', message);
    };

    transport.onerror = (error) => {
      console.error('Error:', error);
    };

    transport.onclose = () => {
      console.log('Connection closed');
    };

    // Connect the client to the transport
    await client.connect(transport);

    // Get available tools from the server
    const toolsResponse = await client.listTools();
    availableTools = toolsResponse.tools;
    console.log('Available tools from server:', JSON.stringify(availableTools, null, 2));

    console.log('Client connected and initialized');

    // Example usage of processMessage
    const message = "get upcoming events on 24th of april";
    console.log('Processing message:', message);
    const result = await processMessage(message, client);
    console.log('\n=== Final Response ===');
    console.log(result.response);
    console.log('\n=== Details ===');
    console.log('Tool used:', result.toolUsed);
    console.log('Arguments:', result.arguments);
    console.log('Raw result:', result.result);

  } catch (error) {
    console.error('Error:', error);
  }
})();