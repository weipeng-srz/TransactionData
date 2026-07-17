package stock

import "testing"

func TestNormalizeSymbol(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"600000", "sh600000"},
		{" 000001 ", "sz000001"},
		{"300750.SZ", "sz300750"},
		{"SH.688001", "sh688001"},
		{"bj920493", "bj920493"},
		{"920493", "bj920493"},
		{"830001", "bj830001"},
		{"900901", "sh900901"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := NormalizeSymbol(tt.input)
			if err != nil {
				t.Fatalf("NormalizeSymbol() error = %v", err)
			}
			if got != tt.want {
				t.Fatalf("NormalizeSymbol() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestNormalizeSymbolRejectsInvalidInput(t *testing.T) {
	for _, input := range []string{"", "ABC", "60000", "6000000"} {
		if _, err := NormalizeSymbol(input); err == nil {
			t.Errorf("NormalizeSymbol(%q) unexpectedly succeeded", input)
		}
	}
}
