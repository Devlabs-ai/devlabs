# Solution — Identity for Settlement Export

Stay in your lab namespace. Create a dedicated ServiceAccount plus least-privilege Role/RoleBinding so settlement automation can only get/list Pods (no Job yet).

Docs: [RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) · [ServiceAccounts](https://kubernetes.io/docs/concepts/security/service-accounts/)

## Solution YAML

Save as `settlement-rbac-identity-l16.yaml`:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: settlement-exporter
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: settlement-exporter-pod-reader
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: settlement-exporter-pod-reader
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: settlement-exporter-pod-reader
subjects:
  - kind: ServiceAccount
    name: settlement-exporter
```

## Declarative

```bash
kubectl apply -f settlement-rbac-identity-l16.yaml
kubectl get sa settlement-exporter
kubectl get role settlement-exporter-pod-reader
kubectl get rolebinding settlement-exporter-pod-reader
```

Confirm all three exist, then **Submit**. Do not create a ClusterRole or use the `default` ServiceAccount.
