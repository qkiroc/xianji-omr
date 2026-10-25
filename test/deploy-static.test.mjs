import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {spawnSync} from 'node:child_process';
test('部署脚本：语法、隔离命名、备份先于迁移、无破坏性命令',async()=>{
 for(const f of ['deploy.sh','bootstrap.sh','build-on-ecs.sh','install-api-deployer.sh'])assert.equal(spawnSync('bash',['-n',new URL('../deploy/'+f,import.meta.url).pathname]).status,0);
 const deploy=await readFile(new URL('../deploy/deploy.sh',import.meta.url),'utf8'),runner=await readFile(new URL('../server/deploy.mjs',import.meta.url),'utf8'),unit=await readFile(new URL('../deploy/xianji-omr.service',import.meta.url),'utf8');
 assert.match(deploy,/flock -n/);assert.match(deploy,/version=.*\$\{commit:0:12\}-\$\$/);assert.match(deploy,/git .* archive HEAD/);assert.match(deploy,/systemctl enable xianji-omr/);assert.ok(runner.indexOf('await backup(')<runner.indexOf('await migrate('));assert.ok(runner.indexOf('await migrate(')<runner.indexOf('await activateRelease('));assert.match(runner,/PORT_OWNED_BY_ANOTHER_PROCESS/);assert.match(unit,/User=xianji-omr/);assert.match(unit,/ProtectSystem=strict/);assert.ok(!/\b(dropdb|reset --hard|iptables|firewall-cmd|setenforce)\b/.test(deploy));
});

test('API部署控制器独立systemd socket/服务，应用仍非root，无SSH/通用执行接口',async()=>{
 const unit=await readFile(new URL('../deploy/xianji-omr.service',import.meta.url),'utf8'),socket=await readFile(new URL('../deploy/xianji-omr-deploy.socket',import.meta.url),'utf8'),agent=await readFile(new URL('../deploy/xianji-omr-deploy.service',import.meta.url),'utf8'),installer=await readFile(new URL('../deploy/install-api-deployer.sh',import.meta.url),'utf8'),build=await readFile(new URL('../deploy/build-on-ecs.sh',import.meta.url),'utf8');
 assert.match(unit,/User=xianji-omr/);assert.match(unit,/NoNewPrivileges=true/);assert.match(socket,/ListenStream=\/run\/xianji-omr-deploy.sock/);assert.match(socket,/SocketMode=0660/);assert.ok(!socket.includes('ListenStream=0.0.0.0'));
 assert.match(agent,/KillMode=control-group/);assert.ok(!installer.includes('restart xianji-omr-deploy'));assert.match(build,/BindsTo=xianji-omr-deploy.service/);
});
