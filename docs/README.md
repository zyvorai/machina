# machina Documentation

Enterprise Linux hypervisor management platform

## Start Here

| Goal | Document |
|------|----------|
| Infrastructure vision | [machina-infrastructure-vision.md](machina-infrastructure-vision.md) |
| KubeVirt migration | [kubevirt-migration.md](kubevirt-migration.md) |
| Observability | [observability.md](guides/observability.md) |
| OpenStack | [openstack.md](openstack.md) |
| **User journeys & acceptance criteria** | [User Stories](USER_STORIES.md) |

## User Stories

Persona-based journeys with acceptance criteria: **[USER_STORIES.md](USER_STORIES.md)**

| Persona | Focus |
|---------|-------|
| Alex (Hypervisor Admin) | Manage VMs, networks, storage on bare metal |
| Morgan (Infra Engineer) | API automation and scheduled actions |
| Jordan (NOC Operator) | Live consoles and fleet metrics |

## Ecosystem

Part of the [Zyvor / HyperSDK platform stack](https://zyvor.dev):

| Product | Role |
|---------|------|
| **hypercluster** | Kubernetes bootstrap |
| **machina** | Bare-metal hypervisor OS |
| **zeus-os (v9s)** | Cloud / KubeVirt control plane |
| **forge** | AI infrastructure on K8s |
| **hypersdk / hyper2kvm** | VM migration |
| **guestkit** | Offline VM assurance |
| **packetwolf** | Network intelligence |
| **Aether** | Runtime portability |
| **hermes** | Application layer for K8s |

See also: [../README.md](../README.md)
