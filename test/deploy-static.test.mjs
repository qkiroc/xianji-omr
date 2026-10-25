import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {spawnSync} from 'node:child_process';
test('部署脚本：语法、隔离命名、备份先于迁移、无破坏性命令',async()=>{
 for(const f of ['deploy.sh','bootstrap.sh'])assert.equal(spawnSync('bash',['-n',new URL('../deploy/'+f,import.meta.url).pathname]).status,0);
 const deploy=await readFile(new URL('../deploy/deploy.sh',import.meta.url),'utf8'),runner=await readFile(new URL('../server/deploy.mjs',import.meta.url),'utf8'),unit=await readFile(new URL('../deploy/xianji-omr.service',import.meta.url),'utf8');
 assert.match(deploy,/flock -n/);assert.match(deploy,/version=.*\$\{commit:0:12\}-\$\$/);assert.match(deploy,/git .* archive HEAD/);assert.match(deploy,/systemctl enable xianji-omr/);assert.ok(runner.indexOf('await backup(')<runner.indexOf('await migrate('));assert.ok(runner.indexOf('await migrate(')<runner.indexOf('await activateRelease('));assert.match(runner,/PORT_OWNED_BY_ANOTHER_PROCESS/);assert.match(unit,/User=xianji-omr/);assert.match(unit,/ProtectSystem=strict/);assert.ok(!/\b(dropdb|reset --hard|iptables|firewall-cmd|setenforce)\b/.test(deploy));
});
