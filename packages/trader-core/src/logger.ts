export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  child(scope: string): Logger;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export class JsonLogger implements Logger {
  public constructor(private readonly scope = "app") {}

  public child(scope: string): Logger {
    return new JsonLogger(`${this.scope}.${scope}`);
  }

  public debug(message: string, fields?: Record<string, unknown>): void {
    this.write("debug", message, fields);
  }

  public info(message: string, fields?: Record<string, unknown>): void {
    this.write("info", message, fields);
  }

  public warn(message: string, fields?: Record<string, unknown>): void {
    this.write("warn", message, fields);
  }

  public error(message: string, fields?: Record<string, unknown>): void {
    this.write("error", message, fields);
  }

  private write(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    const payload = {
      time: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
      ...fields,
    };

    const encoded = JSON.stringify(payload);
    if (level === "error") {
      console.error(encoded);
      return;
    }

    console.log(encoded);
  }
}
