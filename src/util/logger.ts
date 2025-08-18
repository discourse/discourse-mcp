export type LogLevel = "silent" | "error" | "info" | "debug";

export class Logger {
  private levelOrder: Record<LogLevel, number> = {
    silent: 0,
    error: 1,
    info: 2,
    debug: 3,
  };
  constructor(private level: LogLevel = "info") {}

  setLevel(level: LogLevel) {
    this.level = level;
  }

  error(msg: string, meta?: unknown) {
    if (this.levelOrder[this.level] >= 1) {
      this.write("ERROR", msg, meta);
    }
  }

  info(msg: string, meta?: unknown) {
    if (this.levelOrder[this.level] >= 2) {
      this.write("INFO", msg, meta);
    }
  }

  debug(msg: string, meta?: unknown) {
    if (this.levelOrder[this.level] >= 3) {
      this.write("DEBUG", msg, meta);
    }
  }

  private write(level: string, msg: string, meta?: unknown) {
    const line = meta ? `${msg} ${safeJson(meta)}` : msg;
    // Log to stderr per spec
    process.stderr.write(`[${new Date().toISOString()}] ${level} ${line}\n`);
  }
}

function safeJson(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return "<unserializable>";
  }
}

