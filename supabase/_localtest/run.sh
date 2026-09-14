#!/usr/bin/env bash
# Throwaway-Postgres harness for schema.sql. Fresh DB each run.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SQ="$(dirname "$HERE")"
PORT=54329
PSQL() { su postgres -c "psql -h /tmp -p $PORT -d vvs -v ON_ERROR_STOP=1 -q $*" 2>&1; }
su postgres -c "psql -h /tmp -p $PORT -d postgres -c 'drop database if exists vvs;'" >/dev/null 2>&1
su postgres -c "psql -h /tmp -p $PORT -d postgres -c 'create database vvs;'" >/dev/null 2>&1
echo "=== authmock ==="; PSQL "-f $HERE/00_authmock.sql" | grep -v '^$' | tail -3
echo "=== schema (load 1) ==="; out=$(PSQL "-f $SQ/schema.sql"); echo "$out" | grep -iE 'error|fatal' | head -20; echo "load1_errors=$(echo "$out" | grep -icE 'error|fatal')"
echo "=== schema (load 2 — idempotency) ==="; out2=$(PSQL "-f $SQ/schema.sql"); echo "$out2" | grep -iE 'error|fatal' | head -20; echo "load2_errors=$(echo "$out2" | grep -icE 'error|fatal')"
echo "=== scenario ==="; PSQL "-f $HERE/01_scenario.sql" | grep -iE 'error|fatal|ASSERT|SCENARIO' | head -200
