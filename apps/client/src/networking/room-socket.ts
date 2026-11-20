import {
  parseServerMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "@bbm/shared-contracts";

type ClientType = ClientMessage["type"];
type PayloadFor<T extends ClientType> = Extract<
  ClientMessage,
  { type: T }
>["payload"];
type MessageHandler = (message: ServerMessage) => void;
type StatusHandler = (connected: boolean) => void;

export class RoomSocket {
  private socket: WebSocket | null = null;
  private cancelConnect: (() => void) | null = null;
  private readonly listeners = new Set<MessageHandler>();
  private readonly statusListeners = new Set<StatusHandler>();
  private readonly pending = new Map<
    string,
    {
      resolve: (message: ServerMessage) => void;
      reject: (error: Error) => void;
      timer: number;
    }
  >();

  constructor(private readonly baseUrl = apiBaseUrl()) {}

  onMessage(handler: MessageHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusListeners.add(handler);
    return () => this.statusListeners.delete(handler);
  }

  async connect(token: string): Promise<ServerMessage> {
    if (this.socket) this.close();
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    url.search = "";
    url.hash = "";
    const socket = new WebSocket(url);
    this.socket = socket;
    try {
      await this.waitForOpen(socket);
    } catch (error) {
      if (this.socket === socket) this.socket = null;
      if (socket.readyState < WebSocket.CLOSING) socket.close();
      throw error;
    }
    this.statusListeners.forEach((handler) => handler(true));
    socket.addEventListener("message", (event) => this.receive(socket, event));
    socket.addEventListener("close", () => this.closed(socket));
    socket.addEventListener("error", () => {
      if (this.socket === socket) this.emitTransportError();
    });
    return new Promise<ServerMessage>((resolve, reject) => {
      const requestId = createRequestId();
      const timer = window.setTimeout(() => {
        detach();
        this.cancelConnect = null;
        reject(new Error("Guest authentication timed out. Try reconnecting."));
        if (this.socket === socket)
          socket.close(4000, "Authentication timed out");
      }, 10_000);
      const detach = this.onMessage((message) => {
        if (message.type === "authenticated") {
          window.clearTimeout(timer);
          detach();
          this.cancelConnect = null;
          resolve(message);
        } else if (message.type === "protocol_error") {
          window.clearTimeout(timer);
          detach();
          this.cancelConnect = null;
          reject(new Error(message.payload.message));
        }
      });
      const message: ClientMessage = {
        version: PROTOCOL_VERSION,
        requestId,
        type: "authenticate",
        payload: { token },
      };
      try {
        socket.send(JSON.stringify(message));
      } catch {
        window.clearTimeout(timer);
        detach();
        this.cancelConnect = null;
        reject(new Error("Could not authenticate with BBM."));
      }
      this.cancelConnect = () => {
        window.clearTimeout(timer);
        detach();
        reject(new Error("Connection attempt cancelled."));
      };
    });
  }

  request<T extends ClientType>(
    type: T,
    payload: PayloadFor<T>,
  ): Promise<ServerMessage> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("Reconnect to the lobby and try again."));
    const requestId = createRequestId();
    const message: ClientMessage = {
      version: PROTOCOL_VERSION,
      requestId,
      type,
      payload,
    } as ClientMessage;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("The server did not respond. Try again."));
      }, 10_000);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.socket!.send(JSON.stringify(message));
      } catch {
        this.pending.delete(requestId);
        window.clearTimeout(timer);
        reject(new Error("The connection closed before the request was sent."));
      }
    });
  }

  sendMovementInput(input: {
    raceId: string;
    sequence: number;
    horizontal: -1 | 0 | 1;
    jumpDown: boolean;
  }): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    const message: ClientMessage = {
      version: PROTOCOL_VERSION,
      requestId: createRequestId(),
      type: "move_input",
      payload: input,
    };
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  sendPowerUp(raceId: string, slot: 0 | 1): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    const message: ClientMessage = {
      version: PROTOCOL_VERSION,
      requestId: createRequestId(),
      type: "activate_power_up",
      payload: { raceId, slot },
    };
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    this.cancelConnect?.();
    this.cancelConnect = null;
    socket?.close(1000, "Lobby view closed");
    this.rejectPending(new Error("Connection closed."));
    this.statusListeners.forEach((handler) => handler(false));
  }

  private async waitForOpen(socket: WebSocket): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
        this.cancelConnect = null;
        if (error) reject(error);
        else resolve();
      };
      const onOpen = () => finish();
      const onError = () =>
        finish(
          new Error(
            "Could not connect to the selected BBM server. Check the host address, port, origin settings, and firewall.",
          ),
        );
      const onClose = () =>
        finish(new Error("Connection closed before opening."));
      const timer = window.setTimeout(
        () =>
          finish(
            new Error(
              "Connection to the selected BBM server timed out. Check the host address, port, and firewall.",
            ),
          ),
        8_000,
      );
      this.cancelConnect = () =>
        finish(new Error("Connection attempt cancelled."));
      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError, { once: true });
      socket.addEventListener("close", onClose, { once: true });
    });
  }

  private receive(socket: WebSocket, event: MessageEvent<string>): void {
    if (this.socket !== socket) return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(event.data);
    } catch {
      this.emitTransportError();
      return;
    }
    const message = parseServerMessage(decoded);
    if (!message) {
      this.emitTransportError();
      return;
    }
    if (message.requestId) {
      const pending = this.pending.get(message.requestId);
      if (
        pending &&
        (message.type === "protocol_error" ||
          message.type !== "authentication_result")
      ) {
        this.pending.delete(message.requestId);
        window.clearTimeout(pending.timer);
        if (message.type === "protocol_error")
          pending.reject(new Error(message.payload.message));
        else pending.resolve(message);
      }
    }
    this.listeners.forEach((handler) => handler(message));
  }

  private closed(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.statusListeners.forEach((handler) => handler(false));
    this.rejectPending(new Error("Connection lost. Reconnect to continue."));
    this.emitTransportError("Connection lost. Reconnect to continue.");
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private emitTransportError(
    message = "The server sent an invalid response.",
  ): void {
    this.listeners.forEach((handler) =>
      handler({
        version: PROTOCOL_VERSION,
        requestId: null,
        type: "protocol_error",
        payload: { code: "INTERNAL_ERROR", message },
      }),
    );
  }
}

export function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const hostname =
    typeof window === "undefined" ? "127.0.0.1" : window.location.hostname;
  return configured?.trim() || `http://${hostname}:3000`;
}

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function")
    return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
