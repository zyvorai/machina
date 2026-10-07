# Live Migration Actuator

Adds real in-flight migration status/control RPCs to machina-agent. Controls: speed, max downtime, post-copy, abort, bounded vCPU quota, and restore. Status comes from `virsh domjobinfo --rawstats`. Compression is intentionally not claimed as dynamically applied because this transport lacks a safe runtime toggle.
