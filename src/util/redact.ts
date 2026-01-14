export function redactSecrets(input: string): string {
  return input
    .replace(/(Api-Key|User-Api-Key|Authorization):\s*([^\s]+)/gi, "$1: <redacted>")
    .replace(/"http_basic_pass"\s*:\s*"[^"]*"/gi, '"http_basic_pass": "<redacted>"');
}

export function redactObject<T>(obj: T): T {
  const json = JSON.stringify(obj);
  const redacted = redactSecrets(json);
  try {
    return JSON.parse(redacted);
  } catch {
    return obj;
  }
}

