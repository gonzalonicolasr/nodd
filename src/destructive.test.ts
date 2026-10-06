import { test } from "node:test";
import assert from "node:assert/strict";
import { destructiveReason } from "./destructive.ts";

const roots = ["/repo", "/tmp"];
const home = "/home/gon";

test("irreversible commands are named", () => {
  for (const command of [
    "git reset --hard HEAD~3",
    "git clean -fdx",
    "git checkout -- .",
    "git restore .",
    "rm -rf /home/gon/projects/otro",
    "rm -rf ~/Documents",
    "sudo rm -fr /var/lib/thing",
    "psql -c 'DROP TABLE users'",
    "mysql -e \"truncate table orders\"",
    "terraform destroy -auto-approve",
    "kubectl delete namespace prod",
    "cd /repo && git reset --hard",
  ]) assert.ok(destructiveReason(command, roots, home), command);
});

test("ordinary and contained commands pass", () => {
  for (const command of [
    "git reset HEAD a.ts",
    "git checkout -b feature",
    "git restore --staged a.ts",
    "git clean -n",
    "rm -rf build",
    "rm -rf ./node_modules /repo/dist",
    "rm -rf /tmp/claude-1000/x",
    "rm a.ts",
    "grep -rn 'git reset --hard' docs",
    "echo 'DROP TABLE x' > notes.md",
    "kubectl get pods",
  ]) assert.equal(destructiveReason(command, roots, home), null, command);
});

test("the home counts as inside when the session runs in it, and a local test database may be dropped", () => {
  assert.equal(destructiveReason("rm -rf ~/projects/x/build", ["/home/gon", "/tmp"], home), null);
  assert.equal(destructiveReason("rm -rf $HOME/.cache/thing", ["/home/gon"], home), null);
  assert.ok(destructiveReason("rm -rf ~/projects/x", ["/repo"], home));
  assert.equal(destructiveReason("mysql -h127.0.0.1 -P3306 -uroot -e \"DROP DATABASE IF EXISTS t; CREATE DATABASE t;\"", roots, home), null);
  assert.equal(destructiveReason("psql -h localhost -c 'TRUNCATE jobs'", roots, home), null);
  assert.ok(destructiveReason("mysql -h db.prod.internal -e 'DROP TABLE x'", roots, home));
  assert.equal(destructiveReason("echo ok && mysql -h db -e 'SELECT 1'\ncat drop.sql", roots, home), null);
});
