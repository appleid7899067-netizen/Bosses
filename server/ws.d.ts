declare module "ws" {
  type Listener = (...args: any[]) => void;

  export class WebSocket {
    readyState: number;
    static OPEN: number;
    send(data: string | Buffer): void;
    close(): void;
    on(event: string, listener: Listener): this;
  }

  export class WebSocketServer {
    constructor(options: {
      port: number;
      host?: string;
      verifyClient?: (info: { req: { url?: string } }) => boolean;
    });
    on(event: string, listener: Listener): this;
  }
}
