package news

import (
	"math"
	"sort"
	"strings"
)

type weightedTerm struct {
	Term   string
	Weight float64
}

var positiveTerms = []weightedTerm{
	{Term: "超预期", Weight: 2.0},
	{Term: "创新高", Weight: 1.8},
	{Term: "大幅增长", Weight: 1.8},
	{Term: "业绩预增", Weight: 1.8},
	{Term: "扭亏为盈", Weight: 1.8},
	{Term: "风险可控", Weight: 1.5},
	{Term: "增持", Weight: 1.4},
	{Term: "回购", Weight: 1.4},
	{Term: "中标", Weight: 1.4},
	{Term: "获批", Weight: 1.4},
	{Term: "分红", Weight: 1.2},
	{Term: "上涨", Weight: 1.2},
	{Term: "增长", Weight: 1.0},
	{Term: "盈利", Weight: 1.0},
	{Term: "突破", Weight: 1.0},
	{Term: "改善", Weight: 1.0},
	{Term: "利好", Weight: 1.5},
	{Term: "签约", Weight: 1.0},
	{Term: "合作", Weight: 0.8},
	{Term: "领先", Weight: 0.8},
	{Term: "升级", Weight: 0.7},
	{Term: "成功", Weight: 0.7},
}

var negativeTerms = []weightedTerm{
	{Term: "立案调查", Weight: 2.0},
	{Term: "涉嫌违法", Weight: 2.0},
	{Term: "重大亏损", Weight: 2.0},
	{Term: "业绩预减", Weight: 1.8},
	{Term: "退市风险", Weight: 2.0},
	{Term: "警示函", Weight: 1.6},
	{Term: "问询函", Weight: 1.3},
	{Term: "处罚", Weight: 1.6},
	{Term: "违规", Weight: 1.5},
	{Term: "违约", Weight: 1.6},
	{Term: "爆雷", Weight: 1.8},
	{Term: "暴雷", Weight: 1.8},
	{Term: "跌停", Weight: 1.6},
	{Term: "下跌", Weight: 1.2},
	{Term: "亏损", Weight: 1.3},
	{Term: "减持", Weight: 1.2},
	{Term: "下调", Weight: 1.0},
	{Term: "终止", Weight: 1.0},
	{Term: "失败", Weight: 1.0},
	{Term: "事故", Weight: 1.3},
	{Term: "召回", Weight: 1.3},
	{Term: "冻结", Weight: 1.2},
	{Term: "诉讼", Weight: 1.2},
	{Term: "债务", Weight: 0.8},
	{Term: "风险", Weight: 0.7},
}

type sentimentResult struct {
	Label         string
	Score         float64
	PositiveTerms []string
	NegativeTerms []string
}

func analyzeSentiment(title, summary string) sentimentResult {
	positiveScore, positives := scoreTerms(title, summary, positiveTerms)
	negativeScore, negatives := scoreTerms(title, summary, negativeTerms)
	total := positiveScore + negativeScore
	if total == 0 {
		return sentimentResult{Label: "中性"}
	}

	score := (positiveScore - negativeScore) / total
	score = math.Max(-1, math.Min(1, score))
	label := "中性"
	if score >= 0.2 {
		label = "正面"
	} else if score <= -0.2 {
		label = "负面"
	}
	return sentimentResult{
		Label:         label,
		Score:         score,
		PositiveTerms: positives,
		NegativeTerms: negatives,
	}
}

func scoreTerms(title, summary string, terms []weightedTerm) (float64, []string) {
	title = strings.ToLower(title)
	summary = strings.ToLower(summary)
	matched := make([]string, 0)
	score := 0.0
	for _, item := range terms {
		count := strings.Count(title, item.Term)*2 + strings.Count(summary, item.Term)
		if count == 0 {
			continue
		}
		score += float64(count) * item.Weight
		matched = append(matched, item.Term)
	}
	sort.Strings(matched)
	return score, matched
}
