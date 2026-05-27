{{/*
Expand the name of the chart.
*/}}
{{- define "huckleberry-bff.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "huckleberry-bff.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "huckleberry-bff.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{ include "huckleberry-bff.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "huckleberry-bff.selectorLabels" -}}
app.kubernetes.io/name: {{ include "huckleberry-bff.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
