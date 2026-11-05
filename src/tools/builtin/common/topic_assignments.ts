export function projectTopicAssignments(topic: Record<string, unknown> | null | undefined) {
  if (!topic || typeof topic !== "object") return {};

  return {
    ...("assigned_to_user" in topic ? { assigned_to_user: topic.assigned_to_user } : {}),
    ...("assigned_to_group" in topic ? { assigned_to_group: topic.assigned_to_group } : {}),
    ...("indirectly_assigned_to" in topic ? { indirectly_assigned_to: topic.indirectly_assigned_to } : {}),
    ...("assignment_note" in topic ? { assignment_note: topic.assignment_note } : {}),
    ...("assignment_status" in topic ? { assignment_status: topic.assignment_status } : {}),
  };
}
