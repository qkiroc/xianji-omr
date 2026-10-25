#!/usr/bin/env bash
# Invoked by deploy.sh after OS/root checks. No credentials in this phase.
set -Eeuo pipefail
runtime=/opt/xianji-omr/runtime
install -d -m 755 "$runtime"
work=$(mktemp -d "$runtime/bootstrap-XXXXXXXX")
dnf install -y git curl tar xz bzip2 make gcc openssl-devel zlib-devel readline-devel perl bison flex m4 util-linux iproute
fetch() { curl --fail --location --proto '=https' --tlsv1.2 --retry 2 "$1" -o "$2"; }
verify() { local archive=$1 manifest=$2 name=$3 expected; expected=$(awk -v n="$name" '$2==n||$2=="*"n {print $1}' "$manifest"); [[ $expected =~ ^[a-f0-9]{64}$ ]] || return 1; printf '%s  %s\n' "$expected" "$archive" | sha256sum --check --status; }
if [[ ! -x $runtime/node/bin/node ]]; then
 case $(uname -m) in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo 'CPU 不支持'; exit 1 ;; esac
 fetch https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt "$work/node.sha256"
 name=$(awk -v a="$arch" '$2 ~ ("^node-v22\\.[0-9]+\\.[0-9]+-linux-" a "\\.tar\\.xz$") {print $2}' "$work/node.sha256")
 [[ $name =~ ^node-v22\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.xz$ ]]
 fetch "https://nodejs.org/dist/latest-v22.x/$name" "$work/$name"
 verify "$work/$name" "$work/node.sha256" "$name"
 tar -xJf "$work/$name" -C "$work"; mv "$work/${name%.tar.xz}" "$runtime/node"
fi
"$runtime/node/bin/node" -e 'const[a,b]=process.versions.node.split(".").map(Number);if(a!==22||b<18)process.exit(1)'
if [[ ! -x $runtime/postgresql/bin/pg_dump || ! -x $runtime/postgresql/bin/pg_restore ]]; then
 version=18.1; name=postgresql-$version.tar.bz2
 fetch "https://ftp.postgresql.org/pub/source/v$version/$name.sha256" "$work/$name.sha256"
 fetch "https://ftp.postgresql.org/pub/source/v$version/$name" "$work/$name"
 verify "$work/$name" "$work/$name.sha256" "$name"
 tar -xjf "$work/$name" -C "$work"
 cd "$work/postgresql-$version"
 ./configure --prefix="$runtime/postgresql" --without-icu --without-readline --with-ssl=openssl --without-zstd --without-lz4
 make -C src/backend generated-headers
 make -C src/interfaces/libpq
 make -j2 -C src/bin/pg_dump
 make -C src/interfaces/libpq install
 make -C src/bin/pg_dump install
fi
"$runtime/postgresql/bin/pg_dump" --version | grep -Eq 'PostgreSQL\) 18\.'
"$runtime/postgresql/bin/pg_restore" --version | grep -Eq 'PostgreSQL\) 18\.'
