import { useState, useEffect, useCallback } from 'react';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

interface Tool {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

export function useMCPClient() {
  const [client, setClient] = useState<Client | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initializeClient = async () => {
      try {
        const mcpClient = new Client({
          name: "event-agent-frontend",
          version: "1.0.0"
        }, {
          capabilities: {}
        });

        const transport = new SSEClientTransport(
          new URL("http://localhost:3001/sse")
        );

        transport.onmessage = (message) => {
          console.log('Received message:', message);
        };

        transport.onerror = (error) => {
          console.error('Error:', error);
          setError(error.message);
        };

        transport.onclose = () => {
          console.log('Connection closed');
          setIsConnected(false);
        };

        await mcpClient.connect(transport);
        setClient(mcpClient);
        setIsConnected(true);

        // Get available tools from the server
        const toolsResponse = await mcpClient.listTools();
        setTools(toolsResponse.tools);
      } catch (err) {
        console.error('Error initializing client:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize client');
      }
    };

    initializeClient();

    return () => {
      if (client) {
        client.close();
      }
    };
  }, []);

  const sendMessage = useCallback(async (message: string) => {
    if (!client) {
      throw new Error('Client not initialized');
    }

    try {
      const result = await client.callTool({
        name: "get_upcoming_events",
        arguments: {}
      });

      return {
        success: true,
        response: result.content?.[0]?.text || 'No response received'
      };
    } catch (err) {
      console.error('Error sending message:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to process message'
      };
    }
  }, [client]);

  return {
    client,
    tools,
    isConnected,
    error,
    sendMessage
  };
} 