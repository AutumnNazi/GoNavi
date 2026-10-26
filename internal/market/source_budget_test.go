package market

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSourceSizeBudgets(t *testing.T) {
	paths, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	command, err := filepath.Glob("../../cmd/gonavi-market-server/*.go")
	if err != nil {
		t.Fatal(err)
	}
	paths = append(paths, command...)
	for _, path := range paths {
		source, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatal(readErr)
		}
		limit := 800
		if strings.HasSuffix(path, "_test.go") {
			limit = 1500
		}
		if lines := strings.Count(string(source), "\n"); lines > limit {
			t.Errorf("%s has %d lines, limit %d", path, lines, limit)
		}
		fset := token.NewFileSet()
		file, parseErr := parser.ParseFile(fset, path, source, 0)
		if parseErr != nil {
			t.Fatal(parseErr)
		}
		ast.Inspect(file, func(node ast.Node) bool {
			var body *ast.BlockStmt
			switch function := node.(type) {
			case *ast.FuncDecl:
				body = function.Body
			case *ast.FuncLit:
				body = function.Body
			}
			if body != nil {
				lines := fset.Position(body.Rbrace).Line - fset.Position(body.Lbrace).Line
				if lines > 120 {
					t.Errorf("%s:%d function body has %d lines, limit 120", path, fset.Position(body.Lbrace).Line, lines)
				}
			}
			return true
		})
	}
}
