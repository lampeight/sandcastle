// -nocheck
export type IssueNote = {
  body?: string;
  created_at?: string;
  system?: boolean;
};

export type IssueView = {
  state?: string;
  Notes?: IssueNote[];
};

const COMPLETED_BY_SANDCASTLE = "Completed by Sandcastle";
const AUDIT_PASSED_MARKER = "sandcastle_audit_status";

export const extractLatestIssueFollowUp = (issue: IssueView): string => {
  return extractPostCompletionComments(issue).at(-1) ?? "";
};

export const extractPostCompletionComments = (issue: IssueView): string[] => {
  if (issue.state !== "opened") return [];

  const notes = Array.isArray(issue.Notes) ? issue.Notes : [];
  const lastCompletedIndex = findLastCompletedBySandcastle(notes);
  if (lastCompletedIndex === -1) return [];

  return notes
    .slice(lastCompletedIndex + 1)
    .filter((note) => !note.system)
    .map((note) => note.body?.trim() ?? "")
    .filter(Boolean);
};

export const buildIssueFollowUpFeedback = (comment: string): string =>
  [
    "Rework pass: issue follow-up",
    "Priority: address the latest reopened-issue follow-up before broad rediscovery.",
    "Finding 1 [issue-follow-up]: latest human comment after the most recent Completed by Sandcastle marker",
    `Details: ${comment.trim()}`,
  ].join("\n\n");

const findLastCompletedBySandcastle = (notes: IssueNote[]): number => {
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    const body = (notes[index]?.body ?? "").trim();
    if (body === COMPLETED_BY_SANDCASTLE || body.includes(AUDIT_PASSED_MARKER)) {
      return index;
    }
  }
  return -1;
};
