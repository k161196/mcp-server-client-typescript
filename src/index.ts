import "dotenv/config";
import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from 'zod';
import pg from "pg";
// const databaseUrl = process.env.DATABASE_URL;
const pool = new pg.Pool({
host: process.env.POSTGRES_HOST,
port: process.env.POSTGRES_PORT,
user: process.env.POSTGRES_USER,
password: process.env.POSTGRES_PASSWORD,
database: process.env.POSTGRES_DATABASE,
});
// Create an MCP server with implementation details
const server = new McpServer({
  name: 'json-response-streamable-http-server',
  version: '1.0.0',
}, {
  capabilities: {
    logging: {},
  }
});

// server.resource(
//   "event",
//   "event://upcoming-events",
//   async (uri) => {
//     console.log("resource", uri);
//     const sql =  'select * from astro_users au order by au.created_at desc limit 1';

//     const client = await pool.connect();
//     try {
//       await client.query("BEGIN TRANSACTION READ ONLY");
//       const result = await client.query(sql);
//       return{
//         contents: [{
//           uri: uri.href,
//           text: `Upcoming events ${JSON.stringify(result.rows, null, 2)}`,
//           description: `Upcoming events ${JSON.stringify(result.rows, null, 2)}`,
//         }]
//       }
//       // return {
//       //   content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
//       //   isError: false,
//       // };
//     } catch (error) {
//       throw error;
//     } finally {
//       client
//         .query("ROLLBACK")
//         .catch((error) =>
//           console.warn("Could not roll back transaction:", error),
//         );

//       client.release();
//     }

//     // return{
//     //       contents: [{
//     //         uri: uri.href,
//     //         text: `Upcoming events `,
//     //         description: `Upcoming events `,
//     //       }]
//     //     }
    
//     }
// );


server.tool("add",
  { a: z.number(), b: z.number() },
  async ({ a,b }) => {
    console.log("add");
    return {
    content: [{ type: "text", text: String(a + b) }]
  }}
);

server.tool("get_upcoming_events",
  {  },
  async ({  }) => {
    const sql =  `select
	ed.id as event_date_id,
	e.id as event_id,
	e.url_slugs,
	ed.event_start_at,
	ed.registration_end_at,
	e.puja_i18n_en->>'mainPujaText1' as event_name
from
	event_dates ed
inner join events e on
	e.id = ed.event_id
where
	ed.event_start_at >= now()
limit 10`;

    const client = await pool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      const result = await client.query(sql);
      return {
        content: [{ type: "text", text:`Upcoming events ${JSON.stringify(result.rows, null, 2)}`}]
      }
      // return{
      //   contents: [{
      //     uri: uri.href,
      //     text: `Upcoming events ${JSON.stringify(result.rows, null, 2)}`,
      //     description: `Upcoming events ${JSON.stringify(result.rows, null, 2)}`,
      //   }]
      // }
      // return {
      //   content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
      //   isError: false,
      // };
    } catch (error) {
      throw error;
    } finally {
      client
        .query("ROLLBACK")
        .catch((error) =>
          console.warn("Could not roll back transaction:", error),
        );

      client.release();
    }
    console.log("get_upcoming_events");
    return {
    content: [{ type: "text", text: "No upcoming events" }]
  }}
);


const app = express();
app.use(express.json());

// Map to store transports by session ID
const transports: { [sessionId: string]: SSEServerTransport } = {};

app.get("/sse", async (_: Request, res: Response) => {
  const transport = new SSEServerTransport('/messages', res);
  console.log("transport", transport.sessionId);
  transports[transport.sessionId] = transport;
  res.on("close", () => {
    delete transports[transport.sessionId];
  });
  await server.connect(transport);
});

app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  console.log("sessionId", sessionId);
  const transport = transports[sessionId];
  if (transport) {
    try {
      // Create a proper request object with stream properties
      const request = {
        ...req,
        headers: {
          ...req.headers,
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream'
        },
        method: 'POST',
        url: '/messages',
        body: req.body,
        // Add stream-like properties
        readable: true,
        on: (event: string, callback: Function) => {
          if (event === 'data') {
            callback(JSON.stringify(req.body));
          }
          if (event === 'end') {
            callback();
          }
        },
        removeListener: () => {},
        destroy: () => {}
      };
  
      // Handle the message through the transport
      await transport.handlePostMessage(request as any, res);
    } catch (error) {
      console.error('Error handling message:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error'
          },
          id: null
        });
      }
    }
    // await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send('No transport found for sessionId');
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`MCP Streamable HTTP Server listening on port ${PORT}`);
});

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  await server.close();
  process.exit(0);
});