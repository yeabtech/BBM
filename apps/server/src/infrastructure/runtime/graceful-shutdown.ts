import type { Server } from "node:http";

interface ClosableGateway {
  close(): Promise<void>;
}

interface ClosableDatabase {
  close(): Promise<void>;
}

export async function gracefullyCloseServer(
  server: Server,
  gateway: ClosableGateway | null,
  database: ClosableDatabase,
): Promise<void> {
  const httpClosed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  const results = await Promise.allSettled([
    httpClosed,
    gateway?.close() ?? Promise.resolve(),
  ]);
  await database.close();
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed) throw failed.reason;
}
