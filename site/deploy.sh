#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
ssh minipc 'tar czf "$HOME/backups-nodd-site-$(date +%Y%m%d-%H%M%S).tgz" -C /srv/www nodd'
rsync -rtv --exclude tailwind.config.js --exclude deploy.sh ./ minipc:/srv/www/nodd/
for path in / /changelog/; do
  printf '%s https://nodd.ceroclawd.com%s\n' "$(curl -s -o /dev/null -w '%{http_code}' "https://nodd.ceroclawd.com$path")" "$path"
done
