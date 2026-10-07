# EC2-compatible API

`POST /ec2` (also `/ec2/`) accepts form-encoded EC2 Query requests signed with AWS Signature Version 4, so `aws` and boto3
work with an endpoint override:

```bash
# an admin creates an access key (the secret is shown once)
curl -sk -H "Authorization: Bearer $TOKEN" -X POST https://HOST:5092/api/v1/platform/controller/api/v1/ec2/access-keys \
     -d '{"description":"ci"}' -H 'content-type: application/json'

export AWS_ACCESS_KEY_ID=MCAK… AWS_SECRET_ACCESS_KEY=… AWS_DEFAULT_REGION=machina
aws ec2 describe-instances --endpoint-url https://HOST:5092/ec2   # --no-verify-ssl for the self-signed certificate
```

The service name in the credential scope picks the service (see *Service endpoints*); the region is not checked.

## What works
`DescribeInstances`, `DescribeInstanceTypes`, `DescribeTags`, `DescribeKeyPairs`, `StartInstances`, `StopInstances`, and the
actions under *More actions* and *Run, terminate and tags* below. Any other action returns `UnsupportedOperation`.

## For every client: DryRun, ClientToken, filters, pages
- **`DryRun=true`** on any action answers what the real call would, without doing it: `UnauthorizedOperation` when the key's role may not
  do it, otherwise `DryRunOperation` (HTTP 412, as AWS). Only the role is checked; parameters are validated by the real call.
- **`ClientToken`** on `RunInstances` and `CreateLaunchTemplate`: a retry with the same token and the same parameters returns the first
  answer (no second instance); the same token with different parameters is `IdempotentParameterMismatch`; a retry while the first call
  is still running is `ConcurrentIdempotentRequest`. A failed call frees its token. Tokens are per access-key user and kept for a day
  (table `ec2_client_tokens`).
- **Filters** (`Filter.N.Name` / `Value.M`): wildcards `*` and `?` in values, `tag:KEY`, `tag-key` and `tag-value` on every describe that
  lists tags, and the names in the table below. A name the action does not know is `InvalidParameterValue` (it used to match
  nothing, which made a typo look like an empty fleet); a filter without a value is an error too.
- **`MaxResults` (1-1000) and `NextToken`** on every `Describe*` that returns a list. Without `MaxResults` the whole list comes back,
  as before. Tokens are opaque and name the last item returned.

| Describe | Filter names |
|---|---|
| `DescribeInstances` | `instance-id`, `instance-state-name`, `instance-type`, `private-ip-address`, tags |
| `DescribeVolumes` | `volume-id`, `status`, `size`, `attachment.instance-id`, tags |
| `DescribeSecurityGroups` | `group-id`, `group-name`, tags |
| `DescribeImages` | `image-id`, `name`, `is-public`, tags |
| `DescribeVpcs` | `vpc-id`, `cidr`, `cidr-block`, `state`, tags |
| `DescribeSubnets` | `subnet-id`, `vpc-id`, `cidr-block`, `cidr`, `state`, tags |
| `DescribeNetworkInterfaces` | `network-interface-id`, `subnet-id`, `status`, `mac-address`, `private-ip-address`, tags |
| `DescribeKeyPairs` | `key-name`, `key-pair-id`, `fingerprint`, tags |
| `DescribeLaunchTemplates` | `launch-template-id`, `launch-template-name`, tags |
| `DescribeSnapshots` | `snapshot-id`, `volume-id`, `status`, tags |
| `DescribeInstanceTypes` | `instance-type` |
| `DescribeTags` | `key`, `value`, `resource-type`, `resource-id`, tags |

Other describes keep the filters they implement and are not validated.

## Service endpoints
One handler answers `POST /ec2`, `/monitoring`, `/autoscaling` and `/elbv2` (each also with a trailing slash). The path is only an alias:
the service in the signature's credential scope (`…/<region>/<service>/aws4_request`) decides the action table, the XML namespace, the
API version and the error shape, so a client may also send every service to one `endpoint_url`. Any other scope gets `AuthFailure`.

| scope | actions | namespace / `Version` | errors |
|---|---|---|---|
| `ec2` | everything on this page (the CloudWatch-style actions answer here too, for older clients) | `…/ec2…/2016-11-15/` (any `Version` accepted) | `<Response><Errors>` |
| `monitoring` | `DescribeAlarms`, `PutMetricAlarm`, `DeleteAlarms`, `EnableAlarmActions`, `DisableAlarmActions`, `GetMetricStatistics` | `…/monitoring…/2010-08-01/` | `<ErrorResponse><Error><Type>Sender|Receiver…` |
| `autoscaling` | see [Auto Scaling](#auto-scaling) | `…/autoscaling…/2011-01-01/` | as `monitoring` |
| `elasticloadbalancing` | ELBv2, see *ELBv2* below (classic ELB `2012-06-01` is refused with `InvalidParameterValue`; other actions are `InvalidAction`) | `…/elasticloadbalancing…/2015-12-01/` | as `monitoring` |

The `monitoring` answers are the `ec2`-shaped bodies converted to CloudWatch's shape (PascalCase tags, `<member>` lists, ISO 8601
timestamps, no result element for the write actions); only the unit tests have compared that shape with CloudWatch's, no boto3
cloudwatch client has parsed it yet. Signature, clock-skew, key and revocation checks are the same single path for every service.

## Auto Scaling
Service `autoscaling` (`POST /autoscaling`, or any alias with the `autoscaling` credential scope). An Auto Scaling group is an
instance group (`cloud_instance_groups`) that also has an `asg_groups` row, so the existing reconciler keeps doing the work: it
launches into empty slots below the desired capacity, starts stopped members, stops members above it and follows a CPU target.
The Auto Scaling actions change the group's numbers and membership through the same REST handlers the instance-group API uses
(project access and audit stay there); nothing in this service launches or stops an instance by itself.

| area | actions |
|---|---|
| groups | `CreateAutoScalingGroup`, `UpdateAutoScalingGroup`, `DeleteAutoScalingGroup` (`ForceDelete` terminates the members), `DescribeAutoScalingGroups`, `DescribeAutoScalingInstances`, `SetDesiredCapacity`, `TerminateInstanceInAutoScalingGroup`, `AttachInstances`, `DetachInstances`, `SuspendProcesses`, `ResumeProcesses` |
| launch configurations | `CreateLaunchConfiguration`, `DescribeLaunchConfigurations`, `DeleteLaunchConfiguration` (a group made from one gets a template `lc-<name>` in the subnet's project; image, instance type, key pair and user data are applied) |
| policies | `PutScalingPolicy` (`SimpleScaling`, `StepScaling`, `TargetTrackingScaling`), `DescribePolicies`, `DeletePolicy`, `ExecutePolicy` |
| activities and tags | `DescribeScalingActivities`, `CreateOrUpdateTags`, `DeleteTags`, `DescribeTags` |
| fixed answers | `DescribeAccountLimits`, `DescribeAdjustmentTypes`, `DescribeTerminationPolicyTypes`, `DescribeAutoScalingNotificationTypes`, `DescribeScalingProcessTypes`, `DescribeMetricCollectionTypes`, and empty lists for `DescribeLifecycleHooks`, `DescribeNotificationConfigurations`, `DescribeScheduledActions`, `DescribeInstanceRefreshes`, `DescribeLoadBalancers`, `DescribeLoadBalancerTargetGroups`, `DescribeWarmPool` |

How it maps:
- A group lives in **one subnet** (`VPCZoneIdentifier`); its availability zone is the host of that subnet's VPC. The group's project is the subnet's project.
- `LaunchTemplate` takes `LaunchTemplateId` or `LaunchTemplateName` (+ `Version` `1`, `$Latest` or `$Default`; a template has one version until the launch-template-versions package lands) or `LaunchConfigurationName`, not both.
- Capacity is `desired` slots between `MinSize` and `MaxSize` (at most 100). `DefaultCooldown` is the reconciler's cooldown (30 to 86400 s). A listed instance is a member in a slot below the desired capacity; a stopped member above it is scaled in and no longer listed.
- Policies: `ExecutePolicy` applies `ChangeInCapacity`, `ExactCapacity` or `PercentChangeInCapacity` (a percentage truncates toward zero, then moves by at least `MinAdjustmentMagnitude`), clamped to min and max; step scaling needs `MetricValue` and `BreachThreshold` and picks the step the difference falls into (lower bound inclusive, upper exclusive); `HonorCooldown=true` refuses with `ScalingActivityInProgress` inside the cooldown. Target tracking is the reconciler's CPU target (`ASGAverageCPUUtilization`, 10 to 90 percent, one per group). A `SimpleScaling` or one-step `StepScaling` policy with `ChangeInCapacity` can also be the `AlarmActions` entry of `PutMetricAlarm` (on `monitoring` or `ec2`); the alarm then scales its group by that step.
- Activities are recorded for API-driven changes (create, update, set capacity, policy runs, terminate, attach, detach). Launches the reconciler does by itself are not recorded.
- Safety: `SuspendProcesses` of `Launch` and `Terminate` together pauses the group (the reconciler skips it); either alone is refused. A group can be paused or its capacity set to 0 before a delete; a delete with running members is `ResourceInUse` unless `ForceDelete`.

Refused with `UnsupportedOperation` (never silently ignored): every parameter the action does not implement (mixed instances, target group ARNs, classic load balancer names, lifecycle hooks, instance protection, warm pools, capacity rebalance, several subnets, other termination policies than `Default`, health checks other than `EC2`), `EnterStandby`/`ExitStandby`, metrics collection, lifecycle hooks, scheduled actions, instance refresh, notification configurations, load balancer attachment, and on a launch configuration `InstanceMonitoring.Enabled=true` (set it to `false`; Terraform: `enable_monitoring = false`), security groups, block device mappings, spot price and public IP association.

Status: unit-tested against a migrated database and through signed requests (claim C43); no boto3 or Terraform client has run against it. `scripts/ec2/boto3_asg.py` is the live check to run.
## ELBv2
`elasticloadbalancing` answers the ELBv2 query API (`Version` `2015-12-01`; point `boto3.client("elbv2", endpoint_url=".../elbv2")` or Terraform's
`endpoints { elbv2 = ... }` at it). It is built on Machina's native **layer-4** balancer, and says so wherever that matters.

How the objects map: a **listener** with a forward action is one native balancer (`load_balancers`, an iptables rule set on the ELBv2 balancer's
host, `engine/load_balancer.rs`); the **target group's targets** are its members, and the **target group's health check** is its health check
(`lb_health`, probed from the host's agent). `DescribeTargetHealth` reports the native member's health: `initial` until the first probe,
then `healthy` or `unhealthy` (`Target.FailedHealthChecks`); `unused` for a group no listener forwards to. A balancer whose rules the host
rejected shows `State.Code` `failed` with the host's error as `Reason`; the database still holds what was asked for.

| Area | Actions |
|---|---|
| Load balancers | `CreateLoadBalancer`, `DescribeLoadBalancers`, `DeleteLoadBalancer`, `DescribeLoadBalancerAttributes`, `ModifyLoadBalancerAttributes` |
| Target groups | `CreateTargetGroup`, `DescribeTargetGroups`, `ModifyTargetGroup`, `DeleteTargetGroup`, `DescribeTargetGroupAttributes`, `ModifyTargetGroupAttributes` |
| Targets | `RegisterTargets`, `DeregisterTargets`, `DescribeTargetHealth` (targets are instances: `i-…`) |
| Listeners | `CreateListener`, `DescribeListeners`, `ModifyListener`, `DeleteListener`, `DescribeListenerAttributes`, `ModifyListenerAttributes` |
| Rules | `DescribeRules`, `ModifyRule` (the default rule's target group); `CreateRule`, `DeleteRule`, `SetRulePriorities` are refused (see below) |
| Tags | `AddTags`, `RemoveTags`, `DescribeTags` (balancers, target groups, listeners) |
| Static | `DescribeSSLPolicies` (two policies, listed only), `DescribeAccountLimits` (fixed numbers) |

Lists take `Marker` / `PageSize` (1-400) and answer `NextMarker`. ARNs are `arn:aws:elasticloadbalancing:machina:000000000000:loadbalancer/net|app/<name>/<16 hex>`
(likewise `targetgroup/…`, `listener/…`); `DeleteLoadBalancer`, `DeleteListener` and `DeleteTargetGroup` succeed for something already gone.

**Refused, not ignored** (each is `UnsupportedOperation` unless noted):
- Listener protocols other than `TCP`/`UDP` (network) and `HTTP` (application): no `HTTPS`, `TLS`, `TCP_UDP`, `QUIC`; `Certificates`, `SslPolicy`, `AlpnPolicy`.
  `HTTP` is forwarded as TCP: nothing reads the request. A listener whose protocol differs from its target group's is `IncompatibleProtocols`.
- Actions other than a single `forward` to one target group: `redirect`, `fixed-response`, `authenticate-*`, several target groups with weights, stickiness.
- **Listener rules.** There is only each listener's default rule (`Priority` `default`, no conditions). Path, host, header, query-string, method and
  source-IP conditions need a layer-7 router the balancer does not have, so `CreateRule` is refused, `DeleteRule` of the default rule is
  `OperationNotPermitted`, and `SetRulePriorities` is a `ValidationError`.
- `Type` other than `application` / `network`; `IpAddressType` other than `ipv4`; **`SecurityGroups`** on a balancer (not enforced);
  `SubnetMappings.AllocationId`. `Scheme` and `Subnets` are recorded and shown (`internal` / `internet-facing`, `AvailabilityZones`) but do not
  place or isolate anything: the balancer lives on one online host (the oldest not in maintenance or fenced) and listens on that host's address.
- Target groups: protocols other than `TCP`/`UDP`/`HTTP`; `TargetType` other than `instance`; `ProtocolVersion` other than `HTTP1`; health-check protocol
  `HTTPS`, gRPC matchers, and `Matcher.HttpCode` other than `200`, `200-299`, `200-399`. **The probe counts any 2xx or 3xx as healthy**, so a
  matcher of `200` (the SDK default) is accepted but is looser than it says.
- Attributes: unknown keys are `ValidationError`; the ones that promise behaviour Machina lacks are refused when switched on (`access_logs.s3.enabled`,
  `stickiness.enabled`, `proxy_protocol_v2.enabled`, a non-zero `slow_start`, an algorithm other than `round_robin`, HTTP desync/invalid-header handling).
  `deletion_protection.enabled` is enforced. The others (`idle_timeout`, `deregistration_delay`, cross-zone, HTTP/2 …) are stored and reported back
  and change nothing: there is no connection draining.
- **Listener ports are per host**: two balancers cannot both listen on 80/tcp, because they share the host's address (`ValidationError`, nothing is left
  behind). A balancer has one listener per port, so `TCP` and `UDP` on the same port need two balancers.

Run `scripts/ec2/boto3_elbv2.py` against a controller to exercise it with the real SDK.

## Security
- Requests older or newer than 15 minutes (`X-Amz-Date`) are refused, and the signature is compared in constant time.
- Unknown, revoked and wrong-secret keys get the same `AuthFailure` answer.
- A key acts with the role of the admin who created it; start/stop need operator or admin. Revoke with
  `DELETE /api/v1/ec2/access-keys/{id}`.
- The secret has to be recoverable to verify signatures, so it is stored encrypted when `MACHINA_API_KEY_MASTER_KEY` is set
  and in plaintext otherwise: set the master key in production.
- The endpoint sits behind the same rate limit as login.

## More actions
Volumes (`DescribeVolumes`, `CreateVolume`, `DeleteVolume`, `AttachVolume`, `DetachVolume`; device names are `/dev/vdb`…),
security groups (`DescribeSecurityGroups`, `CreateSecurityGroup`, `DeleteSecurityGroup`, `Authorize` and `Revoke` for ingress
and egress, with CIDR or group peers), images (`DescribeImages`), networking (`DescribeVpcs`, `DescribeSubnets`,
`DescribeNetworkInterfaces`), key pairs (`ImportKeyPair` with base64 public key material, `DeleteKeyPair`), and instances
(`RebootInstances`, `ModifyInstanceAttribute` for `InstanceType`). Each maps onto the REST handler, so permissions,
validation and audit are the same. Filters: see the table above.

## Run, terminate and tags
- `RunInstances`: `ImageId` (an `ami-` id or an image name), `MaxCount`/`MinCount` (1–20, see run-instances in
  `cloud-ec2-semantics.md`), optional `InstanceType` (a flavor name), `KeyName`, `UserData` (base64), `SubnetId`, `SecurityGroupId.N`
  and tags from `Tag.N` / `TagSpecification` (an instance `Name` tag becomes the machine name; several machines get `-1…-N`). The
  call waits up to 20 s per machine for its record before answering. Every other parameter is **applied or refused, never dropped**:
  - applied: `LaunchTemplate.LaunchTemplateId` or `LaunchTemplateName` with `Version` `1`, `$Latest` or `$Default` (a template has one
    version; it supplies the image, and parameters you send win); `Placement.AvailabilityZone` (a zone is a host); `InstanceMarketOptions`
    with `MarketType=spot` (the instance is preemptible; `MaxPrice` is accepted and ignored, there is no price market; only one-time
    requests that terminate on interruption); `BlockDeviceMapping` for extra devices (`/dev/sdb`, `/dev/xvdc`, `/dev/vdd`; needs
    `Ebs.VolumeSize` and honours `Ebs.DeleteOnTermination`: each is created, tagged from the `TagSpecification` for `volume`, and attached
    once the instance exists); `Monitoring.Enabled=false`, `MetadataOptions` with the values the platform already has
    (`HttpTokens=optional`, `HttpEndpoint=enabled`), `DisableApiTermination=false`, `Placement.Tenancy=default`.
  - refused with `UnsupportedOperation`: `IamInstanceProfile`, `PrivateIpAddress`, `Ipv6*`, `NetworkInterface.N`, `Monitoring.Enabled=true`
    (metrics are always collected; there is no separate detailed mode), `MetadataOptions.HttpTokens=required` or `HttpEndpoint=disabled`,
    `DisableApiTermination=true`, `Placement.GroupName`/`HostId`/`PartitionNumber`/`Affinity`, a non-default tenancy, a root-disk size
    or a root disk that survives termination, `Ebs.SnapshotId`/`Iops`/`Throughput`/`Encrypted`/`KmsKeyId`, `NoDevice`/`VirtualName`,
    persistent or block-duration spot requests, `TagSpecification` for resources other than instance and volume, and the CPU,
    hibernation, enclave, license, capacity-reservation and GPU options.
  - The root disk has no volume of its own, so `volume` tags apply to the extra volumes only.
- `TerminateInstances`: deletes through the normal delete path. If the cluster requires approval for deletions it is refused,
  exactly as in the UI.
- `CreateTags` / `DeleteTags` on any resource that has an EC2 id (`i-`, `vol-`, `sg-`, `key-`, `ami-`, `eni-`, …).

## Terminated instances
Deleting an instance leaves a tombstone: `DescribeInstances` keeps listing it as `terminated` (state code 48) for an hour,
with its tags, then drops it. `StartInstances`/`StopInstances` on a terminated instance fail with `IncorrectInstanceState`;
terminating it again is a no-op. The Machina UI and `/api/v1/vms` do not list tombstones.

## Also supported (unit-tested, not yet exercised live)
- Elastic IPs: `DescribeAddresses`, `AllocateAddress` (Domain=vpc), `AssociateAddress`, `DisassociateAddress`, `ReleaseAddress`.
- Snapshots and images: `DescribeSnapshots`, `CreateSnapshot` (Atlas-backed volumes only), `DeleteSnapshot`, `CreateVolume` with
  `SnapshotId`, `CreateImage`, `DeregisterImage`, `ModifyImageAttribute` (public/private, share with a project).
- Fleet: `DescribeAvailabilityZones` (a zone is a host), `DescribeAccountAttributes`, launch templates (`CreateLaunchTemplate`
  needs `ProjectId`), and `SubnetId` on `RunInstances`.
- Machina actions: `SleepInstances`, `WakeInstances`, `DescribeSleepPolicies`, `ModifySleepPolicy`, `CreateRestorePoint`,
  `DescribeRestorePoints`, `RewindInstance`, `ForkInstance`, and `ModifyInstanceAttribute` with `Attribute=preemptible`.
- Pagination on `DescribeAddresses` and `DescribeSnapshots` returns a page of up to 100 even without `MaxResults`; every other
  describe pages only when `MaxResults` is given (see above).

- Status, monitoring and groups: `DescribeInstanceStatus` (host-observed state, no second probe), `DescribeAlarms`, `PutMetricAlarm`,
  `DeleteAlarms`, `EnableAlarmActions`, `DisableAlarmActions`, `GetMetricStatistics` (these answer on `POST /ec2` for now),
  `DescribeInstanceGroups`, `UpdateInstanceGroup`, `ModifySubnetAttribute` (`Attribute=nat`), `ModifyInstanceAttribute` with
  `Attribute=groupSet`. `DescribeInstances` fills image id, placement (the host), root device, block-device mappings, security groups, network interfaces, `monitoring` (always `disabled`: see `RunInstances`) and `metadataOptions`.
- VPC: `CreateVpc` (needs `ProjectId`, `CidrBlock`, and `AvailabilityZone` or `HostId`), `DeleteVpc`, `CreateSubnet`, `DeleteSubnet`,
  `DescribeRouteTables`, `CreateRoute`, `DeleteRoute`, `DescribeRegions`. Routes are stored plans: the answer says
  `forwardingActive=false`.
- Volumes and balancers: `DescribeVolumeAttribute`, `ModifyVolumeAttribute` (delete-on-termination, IO limits),
  `DescribeLoadBalancers`, `CreateLoadBalancer`, `DeleteLoadBalancer` (the native L4 balancer, not ELBv2), and `SecurityGroupId.N` on
  `RunInstances`.
- Peering and balancer members: `DescribeVpcPeeringConnections`, `CreateVpcPeeringConnection`, `AcceptVpcPeeringConnection` (status
  `planned`, `forwardingActive=false`: nothing forwards packets), `AllocateSubnetAddress` / `ReleaseSubnetAddress` (the subnet IPAM
  pool, `RequestKey` is idempotent), `DescribeLoadBalancerMembers`, `RegisterInstancesWithLoadBalancer`,
  `DeregisterInstancesFromLoadBalancer`, `ConfigureHealthCheck`.
- Interfaces, grow, backups: `CreateNetworkInterface` (`SubnetId` or `NetworkId`; attaches when `InstanceId` is set),
  `DeleteNetworkInterface`, `AttachNetworkInterface` (create-with-instance only; an existing interface cannot be moved),
  `ModifyVolume` (grow only), `CreateBackup` / `DescribeBackups` / `RestoreBackup` (Machina backup records, not EBS snapshots),
  `DescribeInstanceAttribute` (`instanceType`, `groupSet`, `disableApiTermination`). No secondary private IPs.
- Schedules and game days: `CreateBackupSchedule` / `DescribeBackupSchedules` / `DeleteBackupSchedule` / `VerifyBackup`,
  `CreateVmSchedule` / `DescribeVmSchedules` / `DeleteVmSchedule` (`ActionName` is `start`, `shutdown`, `stop` or `snapshot`),
  `CreateMaintenanceSchedule` / `DescribeMaintenanceSchedules` / `DeleteMaintenanceSchedule` (host maintenance, admin),
  `DescribeExperiments`, `RunExperiment` (`Confirm` must equal the experiment name) and `AbortExperiment`. Creating an experiment
  stays on REST.

- Platform and capacity: `DescribeStacks`, `DescribeStackDrift`, `ConvergeStack`, `SetStackAutoHeal`, `DeleteStack` (creating a stack stays on
  REST: the template is a document), `DescribeMigrationJobs`, `DescribeHaStatus`, `DescribeAudit` (admin), `DescribeNotifications`,
  `DescribeProjects`, `CreateProject` (admin), `DescribeScheduledJobs`, `CreateScheduledJob`, `DeleteScheduledJob`, `DescribeCapacity`,
  `DescribeCostEstimate`, `DescribeRightsizing`, `ProposeResize`, `DescribeConsolidation`, `ProposeConsolidation` (the two proposals file an
  approval action; nothing is resized or moved by the call), `DescribePlacement` (operator: it stores what it computes),
  `CreateWebhook` / `DescribeWebhooks` / `DeleteWebhook` and `FenceHost` (admin).
- Access control: an EC2 access key carries a role, not a project scope. The project-scoped API keys of `docs/claims.md` C16 apply to the
  REST API; they do not narrow what these actions return. Use a role no higher than the caller needs.

## Not yet
- IMDSv2, VPC peering that forwards packets, and multi-host Elastic IP failover.
- Internet and NAT gateways, route-table create/associate, network ACLs, security-group-rule describe/modify, console output, key
  generation, placement groups, spot requests and fleets: planned (see `docs/claims.md`), every one answers `UnsupportedOperation`
  today. The `autoscaling` service accepts signed requests but has no actions yet (`InvalidAction`).
- `DescribeInstances` has no `iamInstanceProfile`, `cpuOptions` or `creditSpecification`.
- CloudWatch: only the six alarm and statistics actions above; no `PutMetricData`, `ListMetrics`, dashboards or log groups.
