#!/bin/sh
# Refuses a deployment whose subnet or port collides with this host.
# Run from the repository root before `docker compose up`; exits non-zero on
# any collision. Adapted from OpenAI-Logs-Manager's scripts/preflight.sh.
#
# The host's routing table does not show every range in use: VPN clients
# (192.168.77.x on the production host) are reached through the default
# gateway, so a Docker network covering them breaks their replies without any
# visible route conflict. That took the host offline on 2026-10-27 and again
# on 2026-11-22, which is why that range is listed explicitly below.
set -eu

RESERVED="192.168.64.0/20"   # VPN client addresses seen on the production host
NET=agent-studio_default     # `name:` in docker-compose.yml, plus _default
PORT=8040

env_get() { sed -n "s/^$1=//p" .env | tail -n 1; }
SUBNET=$(env_get STUDIO_SUBNET)
BIND=$(env_get STUDIO_BIND); BIND=${BIND:-192.168.100.18}
[ -n "$SUBNET" ] || { echo "FAIL: STUDIO_SUBNET not set in .env"; exit 1; }

# Compose will not change the subnet of an existing network.
OWN=$(docker network inspect --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}' "$NET" 2>/dev/null |
      awk '{print $1}' || true)
if [ -n "$OWN" ] && [ "$OWN" != "$SUBNET" ]; then
  echo "FAIL: $NET exists with $OWN, not $SUBNET; run 'docker compose down' first"
  exit 1
fi

# Routes on Docker bridges are skipped here because those networks are listed
# from `docker network inspect` below; any other route, a VPN's, still counts.
USED=$( { ip -4 route | awk '$1 ~ /^[0-9]+\./ && $0 !~ / dev (br-[0-9a-f]+|docker0)( |$)/ {print $1}' ;
          docker network ls -q | xargs docker network inspect \
            --format '{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}' |
            grep -v "^$NET " | awk '{for (i=2;i<=NF;i++) print $i}' ;
          echo "$RESERVED" ; } | grep -v ':' )

python3 - "$SUBNET" $USED <<'PY'
import ipaddress, sys
mine = ipaddress.ip_network(sys.argv[1], strict=True)
clash = [n for n in sys.argv[2:] if mine.overlaps(ipaddress.ip_network(n, strict=False))]
if clash:
    sys.exit("FAIL: %s overlaps %s" % (mine, ", ".join(sorted(set(clash)))))
print("ok: subnet %s overlaps none of %d ranges in use" % (mine, len(set(sys.argv[2:]))))
PY

if ss -Hltn "sport = :$PORT" | grep -q .; then
  [ -n "$(docker compose ps -q app 2>/dev/null)" ] || { echo "FAIL: port $PORT is already listening"; exit 1; }
  echo "ok: port $PORT is this stack's own app container"
else
  echo "ok: $BIND:$PORT is free"
fi
