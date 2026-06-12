export const REVIEW_FEEDBACK_TAGS = [
  { id: 'url-routing', label: 'URL / routing' },
  { id: 'metrics-grafana', label: 'Metrics / Grafana' },
  { id: 'candidate-brief', label: 'Candidate brief' },
  { id: 'compose-infra', label: 'Compose / infra' },
  { id: 'validation-gap', label: 'Validation gap' },
  { id: 'other', label: 'Other' },
];

export function tagLabel(id) {
  return REVIEW_FEEDBACK_TAGS.find((t) => t.id === id)?.label || id;
}
