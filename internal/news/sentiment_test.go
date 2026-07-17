package news

import "testing"

func TestAnalyzeSentiment(t *testing.T) {
	tests := []struct {
		name  string
		title string
		body  string
		want  string
	}{
		{name: "positive", title: "业绩预增并创新高", body: "盈利大幅增长", want: "正面"},
		{name: "negative", title: "公司收到警示函", body: "涉嫌违规并被处罚", want: "负面"},
		{name: "neutral", title: "召开年度股东大会", body: "审议普通议案", want: "中性"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := analyzeSentiment(test.title, test.body)
			if got.Label != test.want {
				t.Fatalf("analyzeSentiment() = %#v, want %s", got, test.want)
			}
		})
	}
}
