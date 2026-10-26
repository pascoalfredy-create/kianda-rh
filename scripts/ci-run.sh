#!/usr/bin/env bash
# Corre um comando; se falhar, publica as últimas linhas como anotação ::error:: (legíveis pela API do GitHub).
# O GitHub oculta automaticamente os secrets nas anotações.
set -o pipefail
label="$1"; shift
out=$(mktemp)
"$@" 2>&1 | tee "$out"
code=${PIPESTATUS[0]}
[ "$code" -eq 0 ] && exit 0
tail -n 40 "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep -v '^\s*$' | tail -n 25 > "$out.tail"
msg=$(sed -e 's/%/%25/g' "$out.tail" | sed -e ':a;N;$!ba;s/\r//g;s/\n/%0A/g')
echo "::error title=${label}::${msg}"
exit $code
