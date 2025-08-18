export function redactSecrets(input: string): string {
  return input.replace(/(Api-Key|Authorization):\s*([^\s]+)/gi, "$1: <redacted>");
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

