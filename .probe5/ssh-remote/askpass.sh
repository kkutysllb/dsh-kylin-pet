#!/bin/sh
exec "/opt/homebrew/Cellar/node@24/24.18.0/bin/node" "/Users/libing/.kcoder/profiles/web/node_modules/dsh-ssh-remote/lib/askpass.js" --file "/Users/libing/kk_Projects/dsh-kylin-pet/.probe5/ssh-remote/credentials.enc" --key "/Users/libing/kk_Projects/dsh-kylin-pet/.probe5/ssh-remote/credentials.key" "$@"
