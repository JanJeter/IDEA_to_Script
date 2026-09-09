import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const bash = process.env.BASH_BIN || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
const source = fs.readFileSync(new URL('./deploy-github.sh', import.meta.url), 'utf8');
const target = 'a'.repeat(40);
const cases = ['success', 'dirty', 'stale', 'diverged', 'backup-fail', 'build-fail', 'health-fail'];
for (const scenario of cases) {
  const setup = `
set -e
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/.git"
touch "$tmp/.env.production"
export CASE=${scenario}
id() { echo 0; }
flock() { return 0; }
git() {
 case "$1 $2" in
 'status --porcelain') [[ "$CASE" != dirty ]] || echo ' M local.txt'; return 0;;
 'branch --show-current') echo master;;
 'rev-parse refs/remotes/github/master') if [[ "$CASE" == stale ]]; then echo bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; else echo ${target}; fi;;
 'rev-parse HEAD') echo bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;;
 'merge-base --is-ancestor') [[ "$CASE" != diverged ]];;
 'merge --ff-only') echo MERGED;;
 esac
}
bash() { echo BACKUP; [[ "$CASE" != backup-fail ]]; }
docker() {
 if [[ "$1" == inspect ]]; then echo healthy; return; fi
 if [[ "$1" == exec ]]; then echo idea2screenplay; return; fi
 case "$*" in
 *'ps -q postgres') echo postgres-existing;;
 *'build api') echo BUILD_API; [[ "$CASE" != build-fail ]];;
 *'build web') echo BUILD_WEB;;
 *'up -d '*api) echo UPDATE_API; [[ "$CASE" != health-fail ]];;
 *'up -d '*web) echo UPDATE_WEB;;
 *'exec -T web'*) echo PROXY_CHECK;;
 esac
}
set -- ${target}
`;
  const transformed = source.replace('root=/opt/Idea2Screenplay-source', 'root="$tmp"').replace('8>/var/lock/idea2screenplay-deploy.lock', '8>"$tmp/deploy.lock"');
  const result = spawnSync(bash, ['-s'], {input: setup + transformed, encoding:'utf8'});
  const output = result.stdout + result.stderr;
  assert.equal(result.status === 0, scenario === 'success', `${scenario}: ${output}`);
  if (['dirty','stale','diverged'].includes(scenario)) assert.ok(!output.includes('BACKUP'), output);
  if (scenario === 'backup-fail') assert.ok(!output.includes('MERGED'), output);
  if (scenario === 'build-fail') assert.ok(!output.includes('UPDATE_API'), output);
  if (scenario === 'health-fail') assert.ok(!output.includes('UPDATE_WEB'), output);
  if (scenario === 'success') {
    for (const [a,b] of [['BACKUP','MERGED'],['BUILD_API','BUILD_WEB'],['BUILD_WEB','UPDATE_API'],['UPDATE_API','UPDATE_WEB'],['UPDATE_WEB','PROXY_CHECK']]) {
      assert.ok(output.indexOf(a) >= 0 && output.indexOf(a) < output.indexOf(b), output);
    }
  }
  console.log(`PASS ${scenario}`);
}
const invalid = spawnSync(bash,['-s','--','invalid'],{input:source,encoding:'utf8'});
assert.notEqual(invalid.status,0);
assert.match(invalid.stderr,/full Git commit SHA/);
console.log('PASS invalid commit rejected');
