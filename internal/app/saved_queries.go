package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"GoNavi-Wails/internal/connection"
	"github.com/google/uuid"
)

const savedQueriesFileName = "saved_queries.json"

const (
	savedQueryGroupTokenPrefix = "group:"
	savedQueryTokenPrefix      = "query:"
)

var savedQueriesMu sync.Mutex

type savedQueriesFile struct {
	Queries []connection.SavedQuery      `json:"queries"`
	Groups  []connection.SavedQueryGroup `json:"groups,omitempty"`
}

type savedQueryRepository struct {
	configDir string
}

func newSavedQueryRepository(configDir string) *savedQueryRepository {
	if strings.TrimSpace(configDir) == "" {
		configDir = resolveAppConfigDir()
	}
	return &savedQueryRepository{configDir: configDir}
}

func (r *savedQueryRepository) queriesPath() string {
	return filepath.Join(r.configDir, savedQueriesFileName)
}

func (r *savedQueryRepository) loadFile() (savedQueriesFile, error) {
	data, err := os.ReadFile(r.queriesPath())
	if err != nil {
		if os.IsNotExist(err) {
			return savedQueriesFile{Queries: []connection.SavedQuery{}, Groups: []connection.SavedQueryGroup{}}, nil
		}
		return savedQueriesFile{}, err
	}

	var file savedQueriesFile
	if err := json.Unmarshal(data, &file); err != nil {
		return savedQueriesFile{}, err
	}
	return normalizeSavedQueriesFile(file), nil
}

func (r *savedQueryRepository) load() ([]connection.SavedQuery, error) {
	file, err := r.loadFile()
	if err != nil {
		return nil, err
	}
	return file.Queries, nil
}

func (r *savedQueryRepository) loadGroups() ([]connection.SavedQueryGroup, error) {
	file, err := r.loadFile()
	if err != nil {
		return nil, err
	}
	return file.Groups, nil
}

func (r *savedQueryRepository) saveFile(file savedQueriesFile) error {
	if err := os.MkdirAll(r.configDir, 0o755); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(normalizeSavedQueriesFile(file), "", "  ")
	if err != nil {
		return err
	}
	return writeSavedQueriesFileAtomic(r.queriesPath(), payload)
}

// saveAll remains available to callers that only replace query content. It
// loads and carries forward saved-query groups instead of silently dropping
// the new metadata.
func (r *savedQueryRepository) saveAll(queries []connection.SavedQuery) error {
	file, err := r.loadFile()
	if err != nil {
		return err
	}
	file.Queries = queries
	return r.saveFile(file)
}

func writeSavedQueriesFileAtomic(targetPath string, payload []byte) error {
	dir := filepath.Dir(targetPath)
	temp, err := os.CreateTemp(dir, ".saved_queries_*.tmp")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tempPath)
		}
	}()

	if _, err := temp.Write(payload); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tempPath, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tempPath, targetPath); err != nil {
		if removeErr := os.Remove(targetPath); removeErr != nil && !os.IsNotExist(removeErr) {
			return err
		}
		if retryErr := os.Rename(tempPath, targetPath); retryErr != nil {
			return retryErr
		}
	}
	cleanup = false
	return nil
}

func (r *savedQueryRepository) Save(input connection.SavedQuery) (connection.SavedQuery, error) {
	savedQueriesMu.Lock()
	defer savedQueriesMu.Unlock()

	query, ok := sanitizeSavedQuery(input, 0, true)
	if !ok {
		return connection.SavedQuery{}, fmt.Errorf("saved query requires sql, connectionId and dbName")
	}

	file, err := r.loadFile()
	if err != nil {
		return connection.SavedQuery{}, err
	}
	queries := file.Queries

	replaced := false
	for index, item := range queries {
		if item.ID == query.ID {
			queries[index] = query
			replaced = true
			break
		}
	}
	if !replaced {
		queries = append(queries, query)
	}
	file.Queries = queries
	if err := r.saveFile(file); err != nil {
		return connection.SavedQuery{}, err
	}
	return query, nil
}

func (r *savedQueryRepository) Import(payload connection.SavedQueryImportPayload, currentConnections []connection.SavedConnectionView) ([]connection.SavedQuery, error) {
	savedQueriesMu.Lock()
	defer savedQueriesMu.Unlock()

	file, err := r.loadFile()
	if err != nil {
		return nil, err
	}
	existing := file.Queries

	byID := make(map[string]int, len(existing)+len(payload.Queries))
	for index, item := range existing {
		byID[item.ID] = index
	}

	imported := resolveSavedQueryBindings(payload.Queries, currentConnections, payload.LegacyConnections)
	for index, item := range imported {
		query, ok := sanitizeSavedQuery(item, index, true)
		if !ok {
			continue
		}
		if existingIndex, found := byID[query.ID]; found {
			existing[existingIndex] = query
			continue
		}
		byID[query.ID] = len(existing)
		existing = append(existing, query)
	}

	file.Queries = existing
	if payload.Groups != nil {
		if err := validateSavedQueryGroupsQueryIDs(payload.Groups, existing); err != nil {
			return nil, err
		}
		file.Groups = mergeSavedQueryGroups(file.Groups, payload.Groups)
	}
	if err := r.saveFile(file); err != nil {
		return nil, err
	}
	return existing, nil
}

func (r *savedQueryRepository) Rebind(id string, target connection.SavedConnectionView) (connection.SavedQuery, error) {
	savedQueriesMu.Lock()
	defer savedQueriesMu.Unlock()

	targetID := strings.TrimSpace(id)
	if targetID == "" || strings.TrimSpace(target.ID) == "" {
		return connection.SavedQuery{}, fmt.Errorf("saved query and target connection are required")
	}

	file, err := r.loadFile()
	if err != nil {
		return connection.SavedQuery{}, err
	}
	queries := file.Queries

	for index, item := range queries {
		if item.ID != targetID {
			continue
		}
		if strings.TrimSpace(item.OriginalConnectionID) == "" && strings.TrimSpace(item.ConnectionID) != strings.TrimSpace(target.ID) {
			item.OriginalConnectionID = item.ConnectionID
		}
		item.ConnectionID = target.ID
		item = applySavedQueryActiveBinding(item, target)
		query, ok := sanitizeSavedQuery(item, index, false)
		if !ok {
			return connection.SavedQuery{}, fmt.Errorf("saved query is invalid: %s", targetID)
		}
		queries[index] = query
		file.Queries = queries
		if err := r.saveFile(file); err != nil {
			return connection.SavedQuery{}, err
		}
		return query, nil
	}

	return connection.SavedQuery{}, fmt.Errorf("saved query not found: %s", targetID)
}

func (r *savedQueryRepository) Delete(id string) error {
	savedQueriesMu.Lock()
	defer savedQueriesMu.Unlock()

	targetID := strings.TrimSpace(id)
	if targetID == "" {
		return nil
	}

	file, err := r.loadFile()
	if err != nil {
		return err
	}
	queries := file.Queries
	filtered := queries[:0]
	for _, item := range queries {
		if item.ID != targetID {
			filtered = append(filtered, item)
		}
	}
	file.Queries = filtered
	return r.saveFile(file)
}

func (r *savedQueryRepository) SaveGroup(input connection.SavedQueryGroup) (connection.SavedQueryGroup, error) {
	savedQueriesMu.Lock()
	defer savedQueriesMu.Unlock()

	file, err := r.loadFile()
	if err != nil {
		return connection.SavedQueryGroup{}, err
	}

	groupID := strings.TrimSpace(input.ID)
	if groupID == "" {
		groupID = "saved-query-group-" + uuid.NewString()
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return connection.SavedQueryGroup{}, fmt.Errorf("saved query group requires a name")
	}

	group := connection.SavedQueryGroup{
		ID:            groupID,
		Name:          name,
		ParentGroupID: strings.TrimSpace(input.ParentGroupID),
		QueryIDs:      sanitizeSavedQueryIDs(input.QueryIDs),
		ChildOrder:    sanitizeSavedQueryGroupChildOrder(input.ChildOrder),
	}
	if err := validateSavedQueryGroupQueryIDs(input.QueryIDs, file.Queries); err != nil {
		return connection.SavedQueryGroup{}, err
	}
	groupIndex := findSavedQueryGroupIndex(file.Groups, groupID)

	nextGroups := append([]connection.SavedQueryGroup(nil), file.Groups...)
	if groupIndex >= 0 {
		nextGroups[groupIndex] = group
	} else {
		nextGroups = append(nextGroups, group)
	}
	if err := validateSavedQueryGroupParent(nextGroups, groupID, group.ParentGroupID); err != nil {
		return connection.SavedQueryGroup{}, err
	}

	nextGroups = removeSavedQueryIDsFromOtherGroups(nextGroups, groupID, group.QueryIDs)
	file.Groups = normalizeSavedQueryGroups(nextGroups, file.Queries)
	if err := r.saveFile(file); err != nil {
		return connection.SavedQueryGroup{}, err
	}

	persistedIndex := findSavedQueryGroupIndex(file.Groups, groupID)
	if persistedIndex < 0 {
		return connection.SavedQueryGroup{}, fmt.Errorf("saved query group could not be persisted: %s", groupID)
	}
	return file.Groups[persistedIndex], nil
}

func (r *savedQueryRepository) DeleteGroup(id string) error {
	savedQueriesMu.Lock()
	defer savedQueriesMu.Unlock()

	groupID := strings.TrimSpace(id)
	if groupID == "" {
		return nil
	}

	file, err := r.loadFile()
	if err != nil {
		return err
	}
	groupIndex := findSavedQueryGroupIndex(file.Groups, groupID)
	if groupIndex < 0 {
		return nil
	}

	removed := file.Groups[groupIndex]
	promotedOrder := resolveSavedQueryGroupChildOrder(groupID, file.Groups)
	removedToken := buildSavedQueryGroupToken(groupID)
	nextGroups := make([]connection.SavedQueryGroup, 0, len(file.Groups)-1)
	for _, candidate := range file.Groups {
		if candidate.ID == groupID {
			continue
		}
		next := candidate
		if next.ParentGroupID == groupID {
			next.ParentGroupID = removed.ParentGroupID
		}
		if next.ID == removed.ParentGroupID {
			next.QueryIDs = append(next.QueryIDs, removed.QueryIDs...)
			next.ChildOrder = replaceSavedQueryGroupChildOrderToken(
				next.ChildOrder,
				removedToken,
				promotedOrder,
			)
		}
		nextGroups = append(nextGroups, next)
	}

	file.Groups = normalizeSavedQueryGroups(nextGroups, file.Queries)
	return r.saveFile(file)
}

func (r *savedQueryRepository) MoveQueryToGroup(queryID string, groupID string) error {
	savedQueriesMu.Lock()
	defer savedQueriesMu.Unlock()

	targetQueryID := strings.TrimSpace(queryID)
	if targetQueryID == "" {
		return fmt.Errorf("saved query is required")
	}

	file, err := r.loadFile()
	if err != nil {
		return err
	}
	if !savedQueryExists(file.Queries, targetQueryID) {
		return fmt.Errorf("saved query not found: %s", targetQueryID)
	}

	targetGroupID := strings.TrimSpace(groupID)
	targetGroupIndex := -1
	if targetGroupID != "" {
		targetGroupIndex = findSavedQueryGroupIndex(file.Groups, targetGroupID)
		if targetGroupIndex < 0 {
			return fmt.Errorf("saved query group not found: %s", targetGroupID)
		}
	}

	queryToken := buildSavedQueryToken(targetQueryID)
	nextGroups := append([]connection.SavedQueryGroup(nil), file.Groups...)
	for index := range nextGroups {
		nextGroups[index].QueryIDs = removeSavedQueryID(nextGroups[index].QueryIDs, targetQueryID)
		nextGroups[index].ChildOrder = removeSavedQueryGroupChildOrderToken(
			nextGroups[index].ChildOrder,
			queryToken,
		)
	}
	if targetGroupIndex >= 0 {
		nextGroups[targetGroupIndex].QueryIDs = append(nextGroups[targetGroupIndex].QueryIDs, targetQueryID)
		nextGroups[targetGroupIndex].ChildOrder = append(nextGroups[targetGroupIndex].ChildOrder, queryToken)
	}

	file.Groups = normalizeSavedQueryGroups(nextGroups, file.Queries)
	return r.saveFile(file)
}

func (r *savedQueryRepository) MoveGroup(groupID string, parentGroupID string) error {
	savedQueriesMu.Lock()
	defer savedQueriesMu.Unlock()

	targetGroupID := strings.TrimSpace(groupID)
	if targetGroupID == "" {
		return fmt.Errorf("saved query group is required")
	}

	file, err := r.loadFile()
	if err != nil {
		return err
	}
	groupIndex := findSavedQueryGroupIndex(file.Groups, targetGroupID)
	if groupIndex < 0 {
		return fmt.Errorf("saved query group not found: %s", targetGroupID)
	}
	nextParentGroupID := strings.TrimSpace(parentGroupID)
	if err := validateSavedQueryGroupParent(file.Groups, targetGroupID, nextParentGroupID); err != nil {
		return err
	}

	groupToken := buildSavedQueryGroupToken(targetGroupID)
	nextGroups := append([]connection.SavedQueryGroup(nil), file.Groups...)
	for index := range nextGroups {
		nextGroups[index].ChildOrder = removeSavedQueryGroupChildOrderToken(
			nextGroups[index].ChildOrder,
			groupToken,
		)
	}
	nextGroups[groupIndex].ParentGroupID = nextParentGroupID
	if nextParentGroupID != "" {
		parentIndex := findSavedQueryGroupIndex(nextGroups, nextParentGroupID)
		nextGroups[parentIndex].ChildOrder = append(nextGroups[parentIndex].ChildOrder, groupToken)
	}

	file.Groups = normalizeSavedQueryGroups(nextGroups, file.Queries)
	return r.saveFile(file)
}

func normalizeSavedQueriesFile(file savedQueriesFile) savedQueriesFile {
	queries := sanitizeSavedQueries(file.Queries)
	return savedQueriesFile{
		Queries: queries,
		Groups:  normalizeSavedQueryGroups(file.Groups, queries),
	}
}

func normalizeSavedQueryGroups(
	input []connection.SavedQueryGroup,
	queries []connection.SavedQuery,
) []connection.SavedQueryGroup {
	validQueryIDs := make(map[string]struct{}, len(queries))
	for _, query := range queries {
		validQueryIDs[query.ID] = struct{}{}
	}

	groups := make([]connection.SavedQueryGroup, 0, len(input))
	seenGroupIDs := make(map[string]struct{}, len(input))
	for index, item := range input {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			continue
		}
		if _, exists := seenGroupIDs[id]; exists {
			continue
		}
		seenGroupIDs[id] = struct{}{}
		name := strings.TrimSpace(item.Name)
		if name == "" {
			name = defaultSavedQueryGroupName(index)
		}
		groups = append(groups, connection.SavedQueryGroup{
			ID:            id,
			Name:          name,
			ParentGroupID: strings.TrimSpace(item.ParentGroupID),
			QueryIDs:      sanitizeSavedQueryIDs(item.QueryIDs),
			ChildOrder:    sanitizeSavedQueryGroupChildOrder(item.ChildOrder),
		})
	}
	if len(groups) == 0 {
		return []connection.SavedQueryGroup{}
	}

	groupIndexByID := make(map[string]int, len(groups))
	for index, group := range groups {
		groupIndexByID[group.ID] = index
	}
	for index := range groups {
		parentID := groups[index].ParentGroupID
		if parentID == "" || parentID == groups[index].ID {
			groups[index].ParentGroupID = ""
			continue
		}
		if _, exists := groupIndexByID[parentID]; !exists {
			groups[index].ParentGroupID = ""
		}
	}

	// Corrupt persisted parent cycles must not make the sidebar recurse forever.
	for _, group := range groups {
		path := make([]string, 0, len(groups))
		pathIndex := make(map[string]int, len(groups))
		currentID := group.ID
		for currentID != "" {
			currentIndex, exists := groupIndexByID[currentID]
			if !exists || groups[currentIndex].ParentGroupID == "" {
				break
			}
			if cycleStart, found := pathIndex[currentID]; found {
				for _, cycleID := range path[cycleStart:] {
					groups[groupIndexByID[cycleID]].ParentGroupID = ""
				}
				break
			}
			pathIndex[currentID] = len(path)
			path = append(path, currentID)
			currentID = groups[currentIndex].ParentGroupID
		}
	}

	assignedQueryIDs := make(map[string]struct{}, len(validQueryIDs))
	for index := range groups {
		filtered := make([]string, 0, len(groups[index].QueryIDs))
		for _, queryID := range groups[index].QueryIDs {
			if _, exists := validQueryIDs[queryID]; !exists {
				continue
			}
			if _, alreadyAssigned := assignedQueryIDs[queryID]; alreadyAssigned {
				continue
			}
			assignedQueryIDs[queryID] = struct{}{}
			filtered = append(filtered, queryID)
		}
		groups[index].QueryIDs = filtered
	}

	for index := range groups {
		childOrder := resolveSavedQueryGroupChildOrder(groups[index].ID, groups)
		groups[index].ChildOrder = childOrder
		queryIDs := make([]string, 0, len(groups[index].QueryIDs))
		for _, token := range childOrder {
			if queryID, ok := parseSavedQueryToken(token); ok {
				queryIDs = append(queryIDs, queryID)
			}
		}
		groups[index].QueryIDs = queryIDs
	}

	return groups
}

func mergeSavedQueryGroups(
	existing []connection.SavedQueryGroup,
	imported []connection.SavedQueryGroup,
) []connection.SavedQueryGroup {
	groups := append([]connection.SavedQueryGroup(nil), existing...)
	for _, item := range imported {
		groupID := strings.TrimSpace(item.ID)
		if groupID == "" {
			continue
		}
		item.ID = groupID
		index := findSavedQueryGroupIndex(groups, groupID)
		if index >= 0 {
			current := groups[index]
			if item.QueryIDs == nil {
				item.QueryIDs = append([]string(nil), current.QueryIDs...)
			}
			if item.ChildOrder == nil {
				item.ChildOrder = append([]string(nil), current.ChildOrder...)
			}
			groups[index] = item
		} else {
			groups = append(groups, item)
		}
		groups = removeSavedQueryIDsFromOtherGroups(groups, groupID, item.QueryIDs)
	}
	return groups
}

func resolveSavedQueryGroupChildOrder(
	groupID string,
	groups []connection.SavedQueryGroup,
) []string {
	groupIndex := findSavedQueryGroupIndex(groups, groupID)
	if groupIndex < 0 {
		return []string{}
	}
	group := groups[groupIndex]
	defaultOrder := make([]string, 0, len(group.QueryIDs)+len(groups))
	for _, queryID := range sanitizeSavedQueryIDs(group.QueryIDs) {
		defaultOrder = append(defaultOrder, buildSavedQueryToken(queryID))
	}
	for _, candidate := range groups {
		if candidate.ParentGroupID == groupID {
			defaultOrder = append(defaultOrder, buildSavedQueryGroupToken(candidate.ID))
		}
	}

	validTokens := make(map[string]struct{}, len(defaultOrder))
	for _, token := range defaultOrder {
		validTokens[token] = struct{}{}
	}
	result := make([]string, 0, len(defaultOrder))
	seen := make(map[string]struct{}, len(defaultOrder))
	for _, token := range sanitizeSavedQueryGroupChildOrder(group.ChildOrder) {
		if _, valid := validTokens[token]; !valid {
			continue
		}
		if _, exists := seen[token]; exists {
			continue
		}
		seen[token] = struct{}{}
		result = append(result, token)
	}
	for _, token := range defaultOrder {
		if _, exists := seen[token]; exists {
			continue
		}
		seen[token] = struct{}{}
		result = append(result, token)
	}
	return result
}

func validateSavedQueryGroupParent(
	groups []connection.SavedQueryGroup,
	groupID string,
	parentGroupID string,
) error {
	parentID := strings.TrimSpace(parentGroupID)
	if parentID == "" {
		return nil
	}
	if parentID == groupID {
		return fmt.Errorf("saved query group cannot be its own parent")
	}
	groupIndexByID := make(map[string]int, len(groups))
	for index, group := range groups {
		groupIndexByID[group.ID] = index
	}
	if _, exists := groupIndexByID[parentID]; !exists {
		return fmt.Errorf("saved query group parent not found: %s", parentID)
	}

	visited := make(map[string]struct{}, len(groups))
	currentID := parentID
	for currentID != "" {
		if currentID == groupID {
			return fmt.Errorf("saved query group cannot be moved below its descendant")
		}
		if _, exists := visited[currentID]; exists {
			return fmt.Errorf("saved query group hierarchy contains a cycle")
		}
		visited[currentID] = struct{}{}
		currentIndex, exists := groupIndexByID[currentID]
		if !exists {
			break
		}
		currentID = strings.TrimSpace(groups[currentIndex].ParentGroupID)
	}
	return nil
}

func validateSavedQueryGroupsQueryIDs(
	groups []connection.SavedQueryGroup,
	queries []connection.SavedQuery,
) error {
	for _, group := range groups {
		if err := validateSavedQueryGroupQueryIDs(group.QueryIDs, queries); err != nil {
			groupID := strings.TrimSpace(group.ID)
			if groupID == "" {
				groupID = strings.TrimSpace(group.Name)
			}
			if groupID == "" {
				groupID = "unknown"
			}
			return fmt.Errorf("saved query group %s: %w", groupID, err)
		}
	}
	return nil
}

func validateSavedQueryGroupQueryIDs(
	queryIDs []string,
	queries []connection.SavedQuery,
) error {
	validQueryIDs := make(map[string]struct{}, len(queries))
	for _, query := range queries {
		validQueryIDs[query.ID] = struct{}{}
	}
	for _, rawID := range queryIDs {
		queryID := strings.TrimSpace(rawID)
		if queryID == "" {
			return fmt.Errorf("saved query group contains an empty query id")
		}
		if _, exists := validQueryIDs[queryID]; !exists {
			return fmt.Errorf("saved query not found: %s", queryID)
		}
	}
	return nil
}

func removeSavedQueryIDsFromOtherGroups(
	groups []connection.SavedQueryGroup,
	targetGroupID string,
	queryIDs []string,
) []connection.SavedQueryGroup {
	if len(queryIDs) == 0 {
		return groups
	}
	requested := make(map[string]struct{}, len(queryIDs))
	for _, queryID := range queryIDs {
		if queryID = strings.TrimSpace(queryID); queryID != "" {
			requested[queryID] = struct{}{}
		}
	}
	if len(requested) == 0 {
		return groups
	}
	for index := range groups {
		if groups[index].ID == targetGroupID {
			continue
		}
		filtered := make([]string, 0, len(groups[index].QueryIDs))
		for _, queryID := range groups[index].QueryIDs {
			if _, remove := requested[queryID]; !remove {
				filtered = append(filtered, queryID)
			}
		}
		groups[index].QueryIDs = filtered
	}
	return groups
}

func findSavedQueryGroupIndex(groups []connection.SavedQueryGroup, groupID string) int {
	targetID := strings.TrimSpace(groupID)
	for index, group := range groups {
		if group.ID == targetID {
			return index
		}
	}
	return -1
}

func savedQueryExists(queries []connection.SavedQuery, queryID string) bool {
	for _, query := range queries {
		if query.ID == queryID {
			return true
		}
	}
	return false
}

func sanitizeSavedQueryIDs(value []string) []string {
	result := make([]string, 0, len(value))
	seen := make(map[string]struct{}, len(value))
	for _, item := range value {
		id := strings.TrimSpace(item)
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result
}

func removeSavedQueryID(ids []string, queryID string) []string {
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != queryID {
			result = append(result, id)
		}
	}
	return result
}

func buildSavedQueryGroupToken(groupID string) string {
	return savedQueryGroupTokenPrefix + groupID
}

func buildSavedQueryToken(queryID string) string {
	return savedQueryTokenPrefix + queryID
}

func parseSavedQueryToken(token string) (string, bool) {
	if !strings.HasPrefix(token, savedQueryTokenPrefix) {
		return "", false
	}
	queryID := strings.TrimSpace(strings.TrimPrefix(token, savedQueryTokenPrefix))
	return queryID, queryID != ""
}

func isSavedQueryGroupChildOrderToken(token string) bool {
	if queryID, ok := parseSavedQueryToken(token); ok && queryID != "" {
		return true
	}
	groupID := strings.TrimSpace(strings.TrimPrefix(token, savedQueryGroupTokenPrefix))
	return strings.HasPrefix(token, savedQueryGroupTokenPrefix) && groupID != ""
}

func sanitizeSavedQueryGroupChildOrder(value []string) []string {
	result := make([]string, 0, len(value))
	seen := make(map[string]struct{}, len(value))
	for _, item := range value {
		token := strings.TrimSpace(item)
		if !isSavedQueryGroupChildOrderToken(token) {
			continue
		}
		if _, exists := seen[token]; exists {
			continue
		}
		seen[token] = struct{}{}
		result = append(result, token)
	}
	return result
}

func removeSavedQueryGroupChildOrderToken(order []string, token string) []string {
	result := make([]string, 0, len(order))
	for _, item := range sanitizeSavedQueryGroupChildOrder(order) {
		if item != token {
			result = append(result, item)
		}
	}
	return result
}

func replaceSavedQueryGroupChildOrderToken(
	order []string,
	token string,
	replacements []string,
) []string {
	replacementTokens := sanitizeSavedQueryGroupChildOrder(replacements)
	replacementSet := make(map[string]struct{}, len(replacementTokens))
	for _, item := range replacementTokens {
		replacementSet[item] = struct{}{}
	}
	result := make([]string, 0, len(order)+len(replacementTokens))
	inserted := false
	for _, item := range sanitizeSavedQueryGroupChildOrder(order) {
		if item == token {
			if !inserted {
				result = append(result, replacementTokens...)
				inserted = true
			}
			continue
		}
		if _, isReplacement := replacementSet[item]; isReplacement {
			continue
		}
		result = append(result, item)
	}
	if !inserted {
		result = append(result, replacementTokens...)
	}
	return result
}

func defaultSavedQueryGroupName(index int) string {
	return fmt.Sprintf("Group %d", index+1)
}

func sanitizeSavedQueries(items []connection.SavedQuery) []connection.SavedQuery {
	result := make([]connection.SavedQuery, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for index, item := range items {
		query, ok := sanitizeSavedQuery(item, index, false)
		if !ok {
			continue
		}
		if _, exists := seen[query.ID]; exists {
			continue
		}
		seen[query.ID] = struct{}{}
		result = append(result, query)
	}
	return result
}

func sanitizeSavedQuery(input connection.SavedQuery, index int, allowGeneratedID bool) (connection.SavedQuery, bool) {
	id := strings.TrimSpace(input.ID)
	if id == "" && allowGeneratedID {
		id = "saved-" + uuid.NewString()
	}
	if id == "" {
		return connection.SavedQuery{}, false
	}

	sqlText := input.SQL
	connectionID := strings.TrimSpace(input.ConnectionID)
	dbName := strings.TrimSpace(input.DBName)
	if strings.TrimSpace(sqlText) == "" || connectionID == "" || dbName == "" {
		return connection.SavedQuery{}, false
	}

	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = defaultSavedQueryName(index)
	}
	createdAt := input.CreatedAt
	if createdAt <= 0 {
		createdAt = time.Now().UnixMilli()
	}

	return connection.SavedQuery{
		ID:                    id,
		Name:                  name,
		SQL:                   sqlText,
		ConnectionID:          connectionID,
		DBName:                dbName,
		CreatedAt:             createdAt,
		ConnectionFingerprint: strings.TrimSpace(input.ConnectionFingerprint),
		FingerprintVersion:    strings.TrimSpace(input.FingerprintVersion),
		BindingStatus:         strings.TrimSpace(input.BindingStatus),
		OriginalConnectionID:  strings.TrimSpace(input.OriginalConnectionID),
	}, true
}

func defaultSavedQueryName(index int) string {
	return fmt.Sprintf("Query %d", index+1)
}
