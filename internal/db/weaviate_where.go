//go:build gonavi_full_drivers || gonavi_weaviate_driver

package db

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// 数据网格的筛选器生成标准 SQL 条件（值一律带引号，如 qty > '5'），这里按集合 schema 的数据类型
// 翻译成 Weaviate 的 where 过滤器：IN 拆成 Or 等值、BETWEEN 拆成区间（旧版本没有 ContainsAny / Not），
// NOT LIKE 等只能用 Not 表达的条件交给服务端判断是否支持。

type gqlEnum string

type gqlField struct {
	key   string
	value interface{}
}

// gqlObject 是保持字段顺序的 GraphQL 输入对象，渲染结果稳定、便于测试。
type gqlObject []gqlField

func renderGraphQLValue(b *strings.Builder, value interface{}) {
	switch typed := value.(type) {
	case gqlEnum:
		b.WriteString(string(typed))
	case gqlObject:
		b.WriteByte('{')
		for index, field := range typed {
			if index > 0 {
				b.WriteString(", ")
			}
			b.WriteString(field.key)
			b.WriteString(": ")
			renderGraphQLValue(b, field.value)
		}
		b.WriteByte('}')
	case []gqlObject:
		items := make([]interface{}, len(typed))
		for index, item := range typed {
			items[index] = item
		}
		renderGraphQLValue(b, items)
	case []string:
		items := make([]interface{}, len(typed))
		for index, item := range typed {
			items[index] = item
		}
		renderGraphQLValue(b, items)
	case []interface{}:
		b.WriteByte('[')
		for index, item := range typed {
			if index > 0 {
				b.WriteString(", ")
			}
			renderGraphQLValue(b, item)
		}
		b.WriteByte(']')
	case string:
		encoded, _ := json.Marshal(typed)
		b.Write(encoded)
	case bool:
		b.WriteString(strconv.FormatBool(typed))
	case int:
		b.WriteString(strconv.Itoa(typed))
	case int64:
		b.WriteString(strconv.FormatInt(typed, 10))
	case float64:
		b.WriteString(strconv.FormatFloat(typed, 'g', -1, 64))
	case json.Number:
		b.WriteString(typed.String())
	default:
		encoded, _ := json.Marshal(typed)
		b.Write(encoded)
	}
}

type weaviateTokenKind int

const (
	weaviateTokWord weaviateTokenKind = iota
	weaviateTokQuotedIdent
	weaviateTokString
	weaviateTokNumber
	weaviateTokOperator
	weaviateTokLParen
	weaviateTokRParen
	weaviateTokComma
)

type weaviateToken struct {
	kind weaviateTokenKind
	text string
}

func tokenizeWeaviateWhere(text string) ([]weaviateToken, error) {
	tokens := make([]weaviateToken, 0, 16)
	for i := 0; i < len(text); {
		ch := text[i]
		switch {
		case ch < 0x80 && unicode.IsSpace(rune(ch)):
			i++
		case ch == '(':
			tokens = append(tokens, weaviateToken{weaviateTokLParen, "("})
			i++
		case ch == ')':
			tokens = append(tokens, weaviateToken{weaviateTokRParen, ")"})
			i++
		case ch == ',':
			tokens = append(tokens, weaviateToken{weaviateTokComma, ","})
			i++
		case ch == '\'':
			value, next, ok := readWeaviateQuoted(text, i, '\'')
			if !ok {
				return nil, weaviateWhereError(text[i:])
			}
			tokens = append(tokens, weaviateToken{weaviateTokString, value})
			i = next
		case ch == '"' || ch == '`':
			value, next, ok := readWeaviateQuoted(text, i, ch)
			if !ok {
				return nil, weaviateWhereError(text[i:])
			}
			tokens = append(tokens, weaviateToken{weaviateTokQuotedIdent, value})
			i = next
		case ch == '[':
			end := strings.IndexByte(text[i:], ']')
			if end < 0 {
				return nil, weaviateWhereError(text[i:])
			}
			tokens = append(tokens, weaviateToken{weaviateTokQuotedIdent, text[i+1 : i+end]})
			i += end + 1
		case strings.ContainsRune("=<>!", rune(ch)):
			start := i
			i++
			if i < len(text) && (text[i] == '=' || (ch == '<' && text[i] == '>')) {
				i++
			}
			op := text[start:i]
			if op == "!" {
				return nil, weaviateWhereError(op)
			}
			tokens = append(tokens, weaviateToken{weaviateTokOperator, op})
		case ch == '-' || ch == '+' || ch == '.' || (ch >= '0' && ch <= '9'):
			start := i
			i++
			for i < len(text) && (isSQLWordByte(text[i]) || text[i] == '.' || ((text[i] == '-' || text[i] == '+') && (text[i-1] == 'e' || text[i-1] == 'E'))) {
				i++
			}
			raw := text[start:i]
			if _, err := strconv.ParseFloat(raw, 64); err != nil {
				return nil, weaviateWhereError(raw)
			}
			tokens = append(tokens, weaviateToken{weaviateTokNumber, raw})
		case isSQLWordByte(ch) || ch >= 0x80:
			start := i
			for i < len(text) && (isSQLWordByte(text[i]) || text[i] == '.' || text[i] >= 0x80) {
				i++
			}
			tokens = append(tokens, weaviateToken{weaviateTokWord, text[start:i]})
		default:
			return nil, weaviateWhereError(string(ch))
		}
	}
	return tokens, nil
}

// readWeaviateQuoted 读取引号包裹的内容，支持重复引号转义（'it”s'）与字符串里的反斜杠转义。
func readWeaviateQuoted(text string, start int, quote byte) (string, int, bool) {
	var b strings.Builder
	for i := start + 1; i < len(text); i++ {
		ch := text[i]
		if ch == '\\' && quote == '\'' && i+1 < len(text) {
			b.WriteByte(text[i+1])
			i++
			continue
		}
		if ch == quote {
			if i+1 < len(text) && text[i+1] == quote {
				b.WriteByte(quote)
				i++
				continue
			}
			return b.String(), i + 1, true
		}
		b.WriteByte(ch)
	}
	return "", len(text), false
}

func weaviateWhereError(near string) error {
	if len(near) > 40 {
		near = near[:40]
	}
	return localizedDatabaseRuntimeError("db.backend.error.weaviate_where_unsupported", map[string]any{"token": strings.TrimSpace(near)})
}

type weaviateLiteral struct {
	kind weaviateTokenKind // weaviateTokString / weaviateTokNumber / weaviateTokWord（TRUE、FALSE）
	text string
}

type weaviateCondition struct {
	field  string
	op     string
	values []weaviateLiteral
}

type weaviateLogical struct {
	op       string // And / Or / Not
	operands []interface{}
}

type weaviateWhereParser struct {
	tokens []weaviateToken
	pos    int
}

func parseWeaviateWhere(text string) (interface{}, error) {
	tokens, err := tokenizeWeaviateWhere(text)
	if err != nil {
		return nil, err
	}
	if len(tokens) == 0 {
		return nil, weaviateWhereError(text)
	}
	parser := weaviateWhereParser{tokens: tokens}
	node, err := parser.parseOr()
	if err != nil {
		return nil, err
	}
	if parser.pos != len(tokens) {
		return nil, weaviateWhereError(tokens[parser.pos].text)
	}
	return node, nil
}

func (p *weaviateWhereParser) peekKeyword(keyword string) bool {
	return p.pos < len(p.tokens) && p.tokens[p.pos].kind == weaviateTokWord && strings.EqualFold(p.tokens[p.pos].text, keyword)
}

func (p *weaviateWhereParser) acceptKeyword(keyword string) bool {
	if p.peekKeyword(keyword) {
		p.pos++
		return true
	}
	return false
}

func (p *weaviateWhereParser) accept(kind weaviateTokenKind) (weaviateToken, bool) {
	if p.pos < len(p.tokens) && p.tokens[p.pos].kind == kind {
		token := p.tokens[p.pos]
		p.pos++
		return token, true
	}
	return weaviateToken{}, false
}

func (p *weaviateWhereParser) errorHere() error {
	if p.pos < len(p.tokens) {
		return weaviateWhereError(p.tokens[p.pos].text)
	}
	return weaviateWhereError("")
}

func (p *weaviateWhereParser) parseOr() (interface{}, error) {
	return p.parseChain("OR", "Or", p.parseAnd)
}

func (p *weaviateWhereParser) parseAnd() (interface{}, error) {
	return p.parseChain("AND", "And", p.parseNot)
}

func (p *weaviateWhereParser) parseChain(keyword, op string, next func() (interface{}, error)) (interface{}, error) {
	first, err := next()
	if err != nil {
		return nil, err
	}
	operands := []interface{}{first}
	for p.acceptKeyword(keyword) {
		operand, err := next()
		if err != nil {
			return nil, err
		}
		operands = append(operands, operand)
	}
	if len(operands) == 1 {
		return first, nil
	}
	return weaviateLogical{op: op, operands: operands}, nil
}

func (p *weaviateWhereParser) parseNot() (interface{}, error) {
	if p.acceptKeyword("NOT") {
		operand, err := p.parseNot()
		if err != nil {
			return nil, err
		}
		return weaviateLogical{op: "Not", operands: []interface{}{operand}}, nil
	}
	if _, ok := p.accept(weaviateTokLParen); ok {
		node, err := p.parseOr()
		if err != nil {
			return nil, err
		}
		if _, ok := p.accept(weaviateTokRParen); !ok {
			return nil, p.errorHere()
		}
		return node, nil
	}
	return p.parseCondition()
}

func (p *weaviateWhereParser) parseCondition() (interface{}, error) {
	fieldToken, ok := p.accept(weaviateTokQuotedIdent)
	if !ok {
		fieldToken, ok = p.accept(weaviateTokWord)
	}
	if !ok {
		return nil, p.errorHere()
	}
	condition := weaviateCondition{field: fieldToken.text}
	if token, ok := p.accept(weaviateTokOperator); ok {
		condition.op = token.text
		if condition.op == "<>" {
			condition.op = "!="
		}
		value, err := p.parseLiteral()
		if err != nil {
			return nil, err
		}
		condition.values = []weaviateLiteral{value}
		return condition, nil
	}
	if p.acceptKeyword("IS") {
		condition.op = "IS NULL"
		if p.acceptKeyword("NOT") {
			condition.op = "IS NOT NULL"
		}
		if !p.acceptKeyword("NULL") {
			return nil, p.errorHere()
		}
		return condition, nil
	}
	negated := p.acceptKeyword("NOT")
	prefix := ""
	if negated {
		prefix = "NOT "
	}
	switch {
	case p.acceptKeyword("LIKE"):
		value, err := p.parseLiteral()
		if err != nil {
			return nil, err
		}
		condition.op, condition.values = prefix+"LIKE", []weaviateLiteral{value}
	case p.acceptKeyword("IN"):
		if _, ok := p.accept(weaviateTokLParen); !ok {
			return nil, p.errorHere()
		}
		for {
			value, err := p.parseLiteral()
			if err != nil {
				return nil, err
			}
			condition.values = append(condition.values, value)
			if _, ok := p.accept(weaviateTokComma); !ok {
				break
			}
		}
		if _, ok := p.accept(weaviateTokRParen); !ok {
			return nil, p.errorHere()
		}
		condition.op = prefix + "IN"
	case p.acceptKeyword("BETWEEN"):
		low, err := p.parseLiteral()
		if err != nil {
			return nil, err
		}
		if !p.acceptKeyword("AND") {
			return nil, p.errorHere()
		}
		high, err := p.parseLiteral()
		if err != nil {
			return nil, err
		}
		condition.op, condition.values = prefix+"BETWEEN", []weaviateLiteral{low, high}
	default:
		return nil, p.errorHere()
	}
	return condition, nil
}

func (p *weaviateWhereParser) parseLiteral() (weaviateLiteral, error) {
	if token, ok := p.accept(weaviateTokString); ok {
		return weaviateLiteral{kind: weaviateTokString, text: token.text}, nil
	}
	if token, ok := p.accept(weaviateTokNumber); ok {
		return weaviateLiteral{kind: weaviateTokNumber, text: token.text}, nil
	}
	if p.peekKeyword("TRUE") || p.peekKeyword("FALSE") {
		token := p.tokens[p.pos]
		p.pos++
		return weaviateLiteral{kind: weaviateTokWord, text: strings.ToLower(token.text)}, nil
	}
	return weaviateLiteral{}, p.errorHere()
}

// weaviateFilterField 是过滤条件左侧解析出的路径与值类型。
type weaviateFilterField struct {
	path     string
	property string
	dataType string // text、string、int、number、boolean、date、uuid、id、timestamp
}

func (w *WeaviateDB) resolveFilterField(class weaviateClass, name string) (weaviateFilterField, error) {
	switch strings.ToLower(name) {
	case weaviateIDColumn, "id":
		return weaviateFilterField{path: "id", property: weaviateIDColumn, dataType: "id"}, nil
	case strings.ToLower(weaviateCreatedColumn):
		return weaviateFilterField{path: weaviateCreatedColumn, property: weaviateCreatedColumn, dataType: "timestamp"}, nil
	case strings.ToLower(weaviateUpdatedColumn):
		return weaviateFilterField{path: weaviateUpdatedColumn, property: weaviateUpdatedColumn, dataType: "timestamp"}, nil
	}
	property, ok := class.property(name)
	if !ok {
		return weaviateFilterField{}, localizedDatabaseRuntimeError("db.backend.error.weaviate_property_not_found", map[string]any{"class": class.Class, "property": name})
	}
	switch base := property.baseType(); base {
	case "text", "string", "int", "number", "boolean", "date", "uuid":
		return weaviateFilterField{path: property.Name, property: property.Name, dataType: base}, nil
	default:
		return weaviateFilterField{}, localizedDatabaseRuntimeError("db.backend.error.weaviate_filter_unsupported", map[string]any{"property": property.Name, "dataType": property.typeLabel()})
	}
}

// valueKey 返回过滤值字段名：1.19 起 text / string 合并为 valueText，旧版本 string 属性与 id 用 valueString。
func (w *WeaviateDB) valueKey(dataType string) string {
	switch dataType {
	case "int":
		return "valueInt"
	case "number":
		return "valueNumber"
	case "boolean":
		return "valueBoolean"
	case "date":
		return "valueDate"
	case "string":
		return "valueString"
	case "id":
		if !w.usesValueText() {
			return "valueString"
		}
	}
	return "valueText"
}

func weaviateFilterValue(field weaviateFilterField, literal weaviateLiteral) (interface{}, error) {
	invalid := func() error {
		return localizedDatabaseRuntimeError("db.backend.error.weaviate_filter_value_invalid", map[string]any{"property": field.property, "dataType": field.dataType, "value": literal.text})
	}
	text := strings.TrimSpace(literal.text)
	switch field.dataType {
	case "int":
		value, err := strconv.ParseInt(text, 10, 64)
		if err != nil {
			if float, floatErr := strconv.ParseFloat(text, 64); floatErr == nil && float == float64(int64(float)) {
				return int64(float), nil
			}
			return nil, invalid()
		}
		return value, nil
	case "number":
		value, err := strconv.ParseFloat(text, 64)
		if err != nil {
			return nil, invalid()
		}
		return value, nil
	case "boolean":
		switch strings.ToLower(text) {
		case "true", "t", "1", "yes", "y":
			return true, nil
		case "false", "f", "0", "no", "n":
			return false, nil
		}
		return nil, invalid()
	case "date":
		value, ok := normalizeWeaviateDate(text)
		if !ok {
			return nil, invalid()
		}
		return value, nil
	default:
		return literal.text, nil
	}
}

// normalizeWeaviateDate 把常见日期写法转成 Weaviate 要求的 RFC3339；无时区时按 UTC。
func normalizeWeaviateDate(text string) (string, bool) {
	if parsed, err := time.Parse(time.RFC3339Nano, text); err == nil {
		return parsed.Format(time.RFC3339Nano), true
	}
	for _, layout := range []string{"2006-01-02T15:04:05", "2006-01-02 15:04:05", "2006-01-02 15:04:05.999999999", "2006-01-02"} {
		if parsed, err := time.Parse(layout, text); err == nil {
			return parsed.UTC().Format(time.RFC3339Nano), true
		}
	}
	return "", false
}

func (w *WeaviateDB) renderFilter(class weaviateClass, node interface{}) (gqlObject, error) {
	switch typed := node.(type) {
	case weaviateLogical:
		operands := make([]gqlObject, 0, len(typed.operands))
		for _, operand := range typed.operands {
			rendered, err := w.renderFilter(class, operand)
			if err != nil {
				return nil, err
			}
			operands = append(operands, rendered)
		}
		return gqlObject{{"operator", gqlEnum(typed.op)}, {"operands", operands}}, nil
	case weaviateCondition:
		return w.renderCondition(class, typed)
	}
	return nil, weaviateWhereError("")
}

func (w *WeaviateDB) renderCondition(class weaviateClass, condition weaviateCondition) (gqlObject, error) {
	field, err := w.resolveFilterField(class, condition.field)
	if err != nil {
		return nil, err
	}
	leaf := func(operator string, literal weaviateLiteral) (gqlObject, error) {
		value, err := weaviateFilterValue(field, literal)
		if err != nil {
			return nil, err
		}
		return gqlObject{{"path", []string{field.path}}, {"operator", gqlEnum(operator)}, {w.valueKey(field.dataType), value}}, nil
	}
	combine := func(op string, operator string, literals []weaviateLiteral) (gqlObject, error) {
		operands := make([]gqlObject, 0, len(literals))
		for _, literal := range literals {
			rendered, err := leaf(operator, literal)
			if err != nil {
				return nil, err
			}
			operands = append(operands, rendered)
		}
		if len(operands) == 1 {
			return operands[0], nil
		}
		return gqlObject{{"operator", gqlEnum(op)}, {"operands", operands}}, nil
	}
	comparisons := map[string]string{"=": "Equal", "!=": "NotEqual", ">": "GreaterThan", ">=": "GreaterThanEqual", "<": "LessThan", "<=": "LessThanEqual"}
	switch condition.op {
	case "IS NULL", "IS NOT NULL":
		return gqlObject{{"path", []string{field.path}}, {"operator", gqlEnum("IsNull")}, {"valueBoolean", condition.op == "IS NULL"}}, nil
	case "LIKE", "NOT LIKE":
		pattern := strings.NewReplacer("%", "*", "_", "?").Replace(condition.values[0].text)
		like := gqlObject{{"path", []string{field.path}}, {"operator", gqlEnum("Like")}, {w.valueKey(field.dataType), pattern}}
		if condition.op == "LIKE" {
			return like, nil
		}
		return gqlObject{{"operator", gqlEnum("Not")}, {"operands", []gqlObject{like}}}, nil
	case "IN":
		return combine("Or", "Equal", condition.values)
	case "NOT IN":
		return combine("And", "NotEqual", condition.values)
	case "BETWEEN", "NOT BETWEEN":
		lowOp, highOp, joiner := "GreaterThanEqual", "LessThanEqual", "And"
		if condition.op == "NOT BETWEEN" {
			lowOp, highOp, joiner = "LessThan", "GreaterThan", "Or"
		}
		low, err := leaf(lowOp, condition.values[0])
		if err != nil {
			return nil, err
		}
		high, err := leaf(highOp, condition.values[1])
		if err != nil {
			return nil, err
		}
		return gqlObject{{"operator", gqlEnum(joiner)}, {"operands", []gqlObject{low, high}}}, nil
	}
	if operator, ok := comparisons[condition.op]; ok {
		return leaf(operator, condition.values[0])
	}
	return nil, weaviateWhereError(condition.op)
}

// parseWeaviateOrderBy 解析 ORDER BY 列表为 Weaviate sort 参数。
func (w *WeaviateDB) parseWeaviateOrderBy(class weaviateClass, text string) ([]gqlObject, error) {
	tokens, err := tokenizeWeaviateWhere(text)
	if err != nil {
		return nil, err
	}
	sorts := make([]gqlObject, 0, 2)
	for i := 0; i < len(tokens); {
		token := tokens[i]
		if token.kind != weaviateTokWord && token.kind != weaviateTokQuotedIdent {
			return nil, weaviateWhereError(token.text)
		}
		field, err := w.resolveFilterField(class, token.text)
		if err != nil {
			return nil, err
		}
		order := "asc"
		i++
		if i < len(tokens) && tokens[i].kind == weaviateTokWord {
			switch strings.ToUpper(tokens[i].text) {
			case "ASC":
				i++
			case "DESC":
				order = "desc"
				i++
			}
		}
		sorts = append(sorts, gqlObject{{"path", []string{field.path}}, {"order", gqlEnum(order)}})
		if i < len(tokens) {
			if tokens[i].kind != weaviateTokComma {
				return nil, weaviateWhereError(tokens[i].text)
			}
			i++
		}
	}
	return sorts, nil
}
