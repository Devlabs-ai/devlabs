# Solution — One Chart, Staging and Prod Values

Stay in your lab namespace. Keep one Notification Service chart; drive staging vs prod with values files. Install **staging** here.

Docs: [Helm values files](https://helm.sh/docs/chart_template_guide/values_files/)

## Solution YAML

`values-staging.yaml`:

```yaml
replicaCount: 1
image:
  repository: rithvikreddyalkanti/notification-service
  tag: "v1.1-rc"
```

`values-prod.yaml` (must exist for review; not installed in this lab):

```yaml
replicaCount: 3
image:
  repository: rithvikreddyalkanti/notification-service
  tag: "v1.1"
```

Reuse the chart from the previous lab (`charts/notification-service/`) with `replicaCount` and image driven by values — do not hard-code staging counts in templates.

## Declarative

```bash
helm upgrade --install notifications ./charts/notification-service   -n "$LEARNER_NS" -f values-staging.yaml
kubectl get deploy notification-service -o wide
kubectl get pods -l app=notification-service -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.containers[0].image}{"\n"}{end}'
```

Wait until **1/1** Ready with image tag `v1.1-rc`, then **Submit**.
