package runharness

// sessionListWhere hides one-shot query-editor generations from the assistant
// history. Each inline completion and text-to-SQL request is its own session
// so the model transcript stays isolated, but that session is not a
// conversation the user opened. A session that also contains a chat run stays
// visible. Sessions with no runs stay visible so a newly opened chat is not
// dropped before the first message.
func sessionListWhere(activeOnly bool) (string, []any) {
	kind := string(AgentTaskKindQueryEditorGeneration)
	conversational := `NOT (
		EXISTS (SELECT 1 FROM runs r WHERE r.session_id = s.id AND r.task_kind = ?)
		AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.session_id = s.id AND r.task_kind != ?)
	)`
	args := []any{kind, kind}
	if activeOnly {
		return ` WHERE archived=0 AND ` + conversational + ` AND EXISTS (SELECT 1 FROM runs r WHERE r.session_id=s.id AND r.state NOT IN ('completed','failed','canceled','exhausted'))`, args
	}
	return ` WHERE ` + conversational, args
}
