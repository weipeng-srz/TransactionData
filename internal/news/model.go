// Package news collects stock-related Chinese news and performs a lightweight
// rule-based sentiment classification suitable for local, dependency-free use.
package news

import "time"

// Article is one normalized news search result.
type Article struct {
	Symbol         string
	CompanyName    string
	Portal         string
	Channel        string
	Media          string
	PublishedAt    time.Time
	Title          string
	Summary        string
	URL            string
	Relevance      float64
	Sentiment      string
	SentimentScore float64
	PositiveTerms  []string
	NegativeTerms  []string
}
