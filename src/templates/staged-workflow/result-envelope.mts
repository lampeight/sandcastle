// -nocheck
export const parseTaggedJson = <T>(
  stdout: string,
  tag: string,
  context: string,
): T => {
  const normalized = stdout.replaceAll(`<\\/${tag}>`, `</${tag}>`);
  const match = normalized.match(
    new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`),
  );
  const payload = match?.[1] ?? extractJsonAfterOpeningTag(normalized, tag);
  if (!payload) {
    const tail = normalized.trim().split("\n").slice(-20).join("\n");
    throw new Error(`${context} did not produce a <${tag}> block.\n\nTail:\n${tail}`);
  }

  try {
    return JSON.parse(payload.trim()) as T;
  } catch (error) {
    throw new Error(
      `${context} produced invalid JSON inside <${tag}>: ${String(error)}`,
    );
  }
};

const extractJsonAfterOpeningTag = (stdout: string, tag: string): string | undefined => {
  const start = stdout.indexOf(`<${tag}>`);
  if (start === -1) return undefined;

  const payloadStart = firstNonWhitespaceIndex(stdout, start + tag.length + 2);
  if (payloadStart === -1) return undefined;

  const end = findJsonValueEnd(stdout, payloadStart);
  return end === undefined ? undefined : stdout.slice(payloadStart, end);
};

const firstNonWhitespaceIndex = (value: string, start: number): number => {
  for (let index = start; index < value.length; index += 1) {
    if (!/\s/.test(value[index]!)) return index;
  }
  return -1;
};

const findJsonValueEnd = (value: string, start: number): number | undefined => {
  const first = value[start];
  const closeForOpen: Record<string, string> = { "{": "}", "[": "]" };
  if (!first || !(first in closeForOpen)) return undefined;

  const stack = [closeForOpen[first]!];
  let inString = false;
  let escaped = false;

  for (let index = start + 1; index < value.length; index += 1) {
    const char = value[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(closeForOpen[char]!);
      continue;
    }
    if (char === "}" || char === "]") {
      if (char !== stack.at(-1)) return undefined;
      stack.pop();
      if (stack.length === 0) return index + 1;
    }
  }

  return undefined;
};
