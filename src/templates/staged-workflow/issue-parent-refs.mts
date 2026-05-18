// -nocheck
export const extractExplicitParentRefs = (issueContext: string): Set<string> => {
  const refs = new Set<string>();
  const patterns = [
    /(?:^|\n)\s*Parent:\s*#(\d+)\b/gi,
    /(?:^|\n)\s*Parent Issue:\s*#(\d+)\b/gi,
    /(?:^|\n)\s*PRD:\s*#(\d+)\b/gi,
    /"parent_id"\s*:\s*"(\d+)"/gi,
    /issues\/(\d+)\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of issueContext.matchAll(pattern)) {
      const issueId = match[1]?.trim();
      if (issueId) refs.add(issueId);
    }
  }

  const parentSectionMatch = issueContext.match(
    /(?:^|\n)##\s*Parent\b([\s\S]*?)(?=\n##\s|\n--\n|$)/i,
  );
  if (!parentSectionMatch) return refs;

  for (const match of parentSectionMatch[1]!.matchAll(/(?:^|\n)\s*[-*]\s+#(\d+)\b/gm)) {
    const issueId = match[1]?.trim();
    if (issueId) refs.add(issueId);
  }

  return refs;
};
