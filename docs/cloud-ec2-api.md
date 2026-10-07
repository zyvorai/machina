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

The service name in the credential scope must be `ec2`; the region is not checked.

## What works
`DescribeInstances` (filters: `instance-id`, `instance-state-name`, `instance-type`, `private-ip-address`, `tag-key`,
`tag:Key`), `DescribeInstanceTypes`, `DescribeTags`, `DescribeKeyPairs`, `StartInstances`, `StopInstances`, and the
actions under *More actions* and *Run, terminate and tags* below. Any other action returns `UnsupportedOperation`. Unknown filter names match nothing.

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
validation and audit are the same. Filters work as for instances (`tag:Key`, `tag-key`, ids, `status`, `group-name`, `name`,
`is-public`); unknown filter names match nothing.

## Run, terminate and tags
- `RunInstances`: `ImageId` (an `ami-` id or an image name), `MaxCount`/`MinCount` (1–20, see run-instances in
  `cloud-ec2-semantics.md`), optional `InstanceType` (a flavor name), `KeyName`, `UserData` (base64) and tags from `Tag.N` /
  `TagSpecification` (an instance `Name` tag becomes the machine name; several machines get `-1…-N`). Subnet, security group
  and block-device parameters are ignored. The call waits up to 20 s per machine for its record before answering.
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
- Pagination: `MaxResults` (1-1000, default 100) and `NextToken` on `DescribeAddresses` and `DescribeSnapshots`; other lists still
  come back whole.

- Status, monitoring and groups: `DescribeInstanceStatus` (host-observed state, no second probe), `DescribeAlarms`, `PutMetricAlarm`,
  `DeleteAlarms`, `EnableAlarmActions`, `DisableAlarmActions`, `GetMetricStatistics` (these answer on `POST /ec2` for now),
  `DescribeInstanceGroups`, `UpdateInstanceGroup`, `ModifySubnetAttribute` (`Attribute=nat`), `ModifyInstanceAttribute` with
  `Attribute=groupSet`. `DescribeInstances` now fills image id, placement, block-device mappings and security groups.
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
- `DescribeInstances` fields that have no Machina equivalent (image id, placement, block-device mappings) are empty.
- CloudWatch-style calls: metrics and alarms are in the REST API (`/api/v1/metrics/statistics`, `/api/v1/alarms`).
