import { EventSource } from "eventsource";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage, JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";

export class SseError extends Error {
  constructor(
    public readonly code: number | undefined,
    message: string | undefined,
    public readonly event: Event,
  ) {
    super(`SSE error: ${message}`);
  }
}

export class SSEClientTransport implements Transport {
  private _eventSource?: EventSource;
  private _endpoint?: URL;
  private _abortController?: AbortController;
  private _url: URL;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(url: URL) {
    this._url = url;
  }

  private _start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._eventSource = new EventSource(this._url.href);
      this._abortController = new AbortController();

      this._eventSource.onerror = (event) => {
        const error = new SseError(undefined, "SSE connection error", event);
        reject(error);
        this.onerror?.(error);
      };

      this._eventSource.onopen = () => {
        // The connection is open, but we need to wait for the endpoint to be received.
      };

      this._eventSource.addEventListener("endpoint", (event: Event) => {
        const messageEvent = event as MessageEvent;

        try {
          this._endpoint = new URL(messageEvent.data, this._url);
          if (this._endpoint.origin !== this._url.origin) {
            throw new Error(
              `Endpoint origin does not match connection origin: ${this._endpoint.origin}`,
            );
          }
        } catch (error) {
          reject(error);
          this.onerror?.(error as Error);
          void this.close();
          return;
        }

        resolve();
      });

      this._eventSource.onmessage = (event: Event) => {
        const messageEvent = event as MessageEvent;
        let message: JSONRPCMessage;
        try {
          message = JSONRPCMessageSchema.parse(JSON.parse(messageEvent.data));
        } catch (error) {
          this.onerror?.(error as Error);
          return;
        }

        this.onmessage?.(message);
      };
    });
  }

  async start() {
    if (this._eventSource) {
      throw new Error(
        "SSEClientTransport already started! If using Client class, note that connect() calls start() automatically.",
      );
    }

    return await this._start();
  }

  async close(): Promise<void> {
    this._abortController?.abort();
    this._eventSource?.close();
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._endpoint) {
      throw new Error("Not connected");
    }

    try {
      const response = await fetch(this._endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(message),
        signal: this._abortController?.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => null);
        throw new Error(
          `Error POSTing to endpoint (HTTP ${response.status}): ${text}`,
        );
      }
    } catch (error) {
      this.onerror?.(error as Error);
      throw error;
    }
  }
} 