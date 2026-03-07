#!/usr/bin/env bash
# Configure n8m.run DNS on Namecheap for GitHub Pages
# Usage: NAMECHEAP_USER=xxx NAMECHEAP_API_KEY=xxx ./scripts/setup-dns.sh

set -euo pipefail

USER="${NAMECHEAP_USER:?Set NAMECHEAP_USER}"
API_KEY="${NAMECHEAP_API_KEY:?Set NAMECHEAP_API_KEY}"
CLIENT_IP="${CLIENT_IP:-$(curl -s https://api.ipify.org)}"

SLD="n8m"
TLD="run"

echo "Setting DNS for ${SLD}.${TLD} from IP ${CLIENT_IP}..."

RESPONSE=$(curl -s "https://api.namecheap.com/xml.response" \
  --data-urlencode "ApiUser=${USER}" \
  --data-urlencode "ApiKey=${API_KEY}" \
  --data-urlencode "UserName=${USER}" \
  --data-urlencode "ClientIp=${CLIENT_IP}" \
  --data-urlencode "Command=namecheap.domains.dns.setHosts" \
  --data-urlencode "SLD=${SLD}" \
  --data-urlencode "TLD=${TLD}" \
  --data-urlencode "HostName1=@" \
  --data-urlencode "RecordType1=A" \
  --data-urlencode "Address1=185.199.108.153" \
  --data-urlencode "TTL1=300" \
  --data-urlencode "HostName2=@" \
  --data-urlencode "RecordType2=A" \
  --data-urlencode "Address2=185.199.109.153" \
  --data-urlencode "TTL2=300" \
  --data-urlencode "HostName3=@" \
  --data-urlencode "RecordType3=A" \
  --data-urlencode "Address3=185.199.110.153" \
  --data-urlencode "TTL3=300" \
  --data-urlencode "HostName4=@" \
  --data-urlencode "RecordType4=A" \
  --data-urlencode "Address4=185.199.111.153" \
  --data-urlencode "TTL4=300" \
  --data-urlencode "HostName5=www" \
  --data-urlencode "RecordType5=CNAME" \
  --data-urlencode "Address5=lee-holdings-international.github.io." \
  --data-urlencode "TTL5=300")

echo "$RESPONSE"

if echo "$RESPONSE" | grep -q 'Status="OK"'; then
  echo ""
  echo "DNS records set successfully!"
  echo "  Verify with: dig n8m.run +noall +answer"
else
  echo ""
  echo "Something went wrong. Check the response above."
  exit 1
fi
