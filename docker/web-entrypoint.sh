#!/bin/sh
# Renders /etc/nginx/templates/*.template into /etc/nginx/conf.d/ (dropping ".template"),
# then runs nginx in the foreground. Only variables that are set in the environment are
# substituted, so nginx's own variables ($host, $uri, ...) are left untouched. This mirrors
# the official nginx image's template step.
set -eu

defined_envs=$(printf '${%s} ' $(awk 'END { for (name in ENVIRON) print name }' </dev/null))

for template in /etc/nginx/templates/*.template; do
  [ -e "$template" ] || continue
  output="/etc/nginx/conf.d/$(basename "$template" .template)"
  envsubst "$defined_envs" <"$template" >"$output"
done

# -e: log to stderr from the very start; the compiled-in error log path isn't writable here.
exec nginx -e /dev/stderr -g 'daemon off;'
