package plugin

import "testing"

func TestValidateDataSourceReadOnly(t *testing.T) {
	source := DataSource{ID: "db", Name: "DB", Dialect: "sqlite", Command: "db", ReadOnly: true}
	if err := ValidateDataSource(source); err != nil {
		t.Fatal(err)
	}
	source.ReadOnly = false
	if err := ValidateDataSource(source); err != nil {
		t.Fatalf("writable declaration rejected: %v", err)
	}
	if err := ValidateDataSourceCommand(source, Command{ID: "db", Effect: "write"}); err != nil {
		t.Fatalf("writable source rejected a write command: %v", err)
	}
	source.ReadOnly = true
	source.Dialect = "oracle"
	if err := ValidateDataSource(source); err == nil {
		t.Fatal("unknown dialect was accepted")
	}
	source.Dialect = "sqlite"
	source.ReadOnly = true
	source.ID = "Fixture"
	if err := ValidateDataSource(source); err == nil {
		t.Fatal("uppercase id was accepted")
	}
	source.ID = "db"
	source.Name = " "
	if err := ValidateDataSource(source); err == nil {
		t.Fatal("blank name was accepted")
	}
	source.Name = "DB"
	for _, effect := range []string{"", "read", "unknown"} {
		if err := ValidateDataSourceCommand(source, Command{ID: "db", Effect: effect}); err != nil {
			t.Fatal(effect, err)
		}
	}
	for _, effect := range []string{"write", "WRITE", "sideeffect"} {
		if err := ValidateDataSourceCommand(source, Command{ID: "db", Effect: effect}); err == nil {
			t.Fatalf("%s effect was accepted", effect)
		}
	}
}
