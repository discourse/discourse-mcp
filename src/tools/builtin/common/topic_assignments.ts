export function projectTopicAssignments(topic: Record<string, unknown> | null | undefined) {
  return {
    ...(topic && "assigned_to_user" in topic ? { assigned_to_user: topic.assigned_to_user } : {}),
    ...(topic && "assigned_to_group" in topic ? { assigned_to_group: topic.assigned_to_group } : {}),
    ...(topic && "indirectly_assigned_to" in topic ? { indirectly_assigned_to: topic.indirectly_assigned_to } : {}),
  };
}
