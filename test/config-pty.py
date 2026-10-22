#!/usr/bin/env python3
"""Private config terminal test. Fake secrets only; never touches /etc or cloud."""
import os, pty, select, subprocess, tempfile, pathlib, time, json, stat
repo=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='omr-config-test-') as temp:
    temp=pathlib.Path(temp); config=temp/'config.json'; harness=temp/'setup.mjs'
    harness.write_text("import {runSetup} from "+json.dumps((repo/'server/setup-config.mjs').as_uri())+";try{await runSetup({path:"+json.dumps(str(config))+",gid:0})}catch{process.exitCode=1}")
    master,slave=pty.openpty(); process=subprocess.Popen(['node',str(harness)],stdin=slave,stdout=slave,stderr=slave);os.close(slave)
    output=b''
    def wait_for(text):
        global output
        deadline=time.time()+8
        while text.encode() not in output:
            if time.time()>deadline:raise AssertionError('terminal prompt timeout: '+text)
            if select.select([master],[],[],.2)[0]:
                try:output+=os.read(master,8192)
                except OSError:raise AssertionError('terminal closed early')
    def answer(label,value):
        wait_for(label);os.write(master,(value+'\n').encode())
    fake_db='FakeDB-NotReal-Secret';fake_login='FakeLogin-NotReal-123';fake_id='FakeAKID';fake_secret='FakeAKSecret-NotReal'
    for label,value in [('PostgreSQL 主机','127.0.0.1'),('PG端口','5432'),('专用xianji_omr账号密码',fake_db),('数据库TLS','disable'),('管理员登录名','admin'),('管理员密码（',fake_login),('再次输入管理员密码',fake_login),('监听地址','127.0.0.1'),('HTTP端口','8790'),('浏览器访问Origin','http://127.0.0.1:8790'),('OSS Bucket','xianji-source'),('OSS Region','oss-cn-beijing'),('OSS HTTPS endpoint','https://oss-cn-beijing.aliyuncs.com'),('对象前缀','omr/'),('OSS认证','ak'),('AccessKey ID',fake_id),('AccessKey Secret',fake_secret)]:answer(label,value)
    assert process.wait(timeout=8)==0
    while select.select([master],[],[],.1)[0]:
        try:output+=os.read(master,8192)
        except OSError:break
    os.close(master)
    for secret in [fake_db,fake_login,fake_id,fake_secret]:assert secret.encode() not in output,'secret echoed'
    c=json.loads(config.read_text());assert c['database']['database']=='xianji_omr';assert fake_login not in config.read_text();assert stat.S_IMODE(config.stat().st_mode)==0o640
    original=config.read_bytes();r=subprocess.run(['node',str(harness)],capture_output=True);assert r.returncode==0;assert config.read_bytes()==original
    config.unlink();master,slave=pty.openpty();process=subprocess.Popen(['node',str(harness)],stdin=slave,stdout=slave,stderr=slave);os.close(slave);output=b'';wait_for('PostgreSQL 主机');os.write(master,b'\x03');assert process.wait(timeout=8)!=0;assert not config.exists();assert not list(temp.glob('*.tmp-*'));os.close(master)
print('PASS: 私密输入不回显、原子0640配置、幂等复用、Ctrl+C清理')
