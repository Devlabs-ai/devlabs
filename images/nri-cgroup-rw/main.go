// NRI plugin that lets Linux-lab learner machines run systemd as PID 1.
//
// containerd mounts /sys/fs/cgroup read-only in unprivileged containers, and systemd
// cannot start without writing its own scopes there. For containers that opt in via the
// pod annotation and run in a user namespace, this plugin re-adds that mount read-write.
// runc then hands the container's own cgroup to the container's (unprivileged) root;
// limit files such as memory.max stay owned by the host, so the pod's limits still hold.
//
// Never applied without a user namespace: a writable cgroupfs for host-mapped root would
// let the container change its own limits.
package main

import (
	"context"
	"log"
	"os"

	"github.com/containerd/nri/pkg/api"
	"github.com/containerd/nri/pkg/stub"
)

const (
	optInAnnotation = "devlabs.io/cgroup-rw"
	cgroupMount     = "/sys/fs/cgroup"
)

type plugin struct{}

func (p *plugin) CreateContainer(_ context.Context, pod *api.PodSandbox, ctr *api.Container) (*api.ContainerAdjustment, []*api.ContainerUpdate, error) {
	if pod.GetAnnotations()[optInAnnotation] != "true" {
		return nil, nil, nil
	}
	if !hasNamespace(ctr, "user") || !hasNamespace(ctr, "cgroup") {
		log.Printf("skip %s/%s %s: needs user + cgroup namespaces", pod.GetNamespace(), pod.GetName(), ctr.GetName())
		return nil, nil, nil
	}

	adjust := &api.ContainerAdjustment{}
	adjust.RemoveMount(cgroupMount)
	adjust.AddMount(&api.Mount{
		Destination: cgroupMount,
		Type:        "cgroup",
		Source:      "cgroup",
		Options:     []string{"nosuid", "noexec", "nodev", "relatime", "rw"},
	})
	log.Printf("cgroupfs rw for %s/%s %s", pod.GetNamespace(), pod.GetName(), ctr.GetName())
	return adjust, nil, nil
}

func hasNamespace(ctr *api.Container, typ string) bool {
	for _, ns := range ctr.GetLinux().GetNamespaces() {
		if ns.GetType() == typ {
			return true
		}
	}
	return false
}

func main() {
	s, err := stub.New(&plugin{},
		stub.WithPluginName("devlabs-cgroup-rw"),
		stub.WithPluginIdx("10"),
		stub.WithOnClose(func() { log.Print("NRI connection closed"); os.Exit(1) }),
	)
	if err != nil {
		log.Fatalf("create plugin stub: %v", err)
	}
	if err := s.Run(context.Background()); err != nil {
		log.Fatalf("plugin exited: %v", err)
	}
}
