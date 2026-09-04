#!/bin/sh
set -eu

model_ip="${SELF_EVOLVE_MODEL_IP:-221.194.152.171}"
model_port="${SELF_EVOLVE_MODEL_PORT:-443}"

iptables-restore <<EOF
*filter
:INPUT ACCEPT [0:0]
:FORWARD DROP [0:0]
:OUTPUT DROP [0:0]
-A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
-A OUTPUT -o lo -d 127.0.0.1/32 -j ACCEPT
-A OUTPUT -d ${model_ip}/32 -p tcp --dport ${model_port} -j ACCEPT
COMMIT
EOF

ip6tables-restore <<'EOF'
*filter
:INPUT ACCEPT [0:0]
:FORWARD DROP [0:0]
:OUTPUT DROP [0:0]
-A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
-A OUTPUT -o lo -d ::1/128 -j ACCEPT
COMMIT
EOF

touch /tmp/self-evolve-network-ready
exec tail -f /dev/null

