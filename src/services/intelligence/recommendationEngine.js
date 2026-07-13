export function buildRecommendations(insights = [], opportunities = []) {
  const recommendations = insights.slice(0, 5).map((insight) => ({ id: `insight-${insight.id}`, title: insight.description, reason: `${insight.severity} criticidade · prioridade ${insight.score}`, score: insight.score }))
  opportunities.slice(0, 5).forEach((item) => recommendations.push({ id: `opportunity-${item.id}`, title: `Considere ${item.service} para ${item.client}.`, reason: `${item.reason} Confiança de ${item.confidence}%.`, score: item.confidence + Math.min(item.estimatedValue / 1000, 20) }))
  return recommendations.sort((a, b) => b.score - a.score).slice(0, 8)
}
