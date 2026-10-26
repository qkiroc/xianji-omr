"""Authenticated HTTP plus a durable, ordered event outbox; credentials stay local."""
import hashlib,json,os,time,threading,urllib.request,urllib.error
from pathlib import Path
from prepare_dataset import save_json,sha_file

class PlatformHTTPError(RuntimeError):
    def __init__(self,status,message):
        self.status=status
        super().__init__('Platform HTTP '+str(status)+': '+message)

class Platform:
    def __init__(self,origin,repo_root=None):
        self.origin=origin.rstrip('/')
        from urllib.parse import urlsplit
        u=urlsplit(self.origin)
        if u.scheme not in ('http','https') or not u.netloc or u.username or u.password or u.path or u.query or u.fragment:raise ValueError('Use an HTTP(S) origin')
        config=Path(os.environ.get('XDG_CONFIG_HOME') or os.environ.get('APPDATA') or Path.home()/'.config')
        name=hashlib.sha256(self.origin.encode()).hexdigest()+'.json'
        paths=[config/'xianji-omr'/name]
        if repo_root:paths.append(Path(repo_root)/'.artifacts/cli-config/xianji-omr'/name)
        credential=next((json.loads(p.read_text(encoding='utf-8')) for p in paths if p.exists()),None)
        if not credential:raise RuntimeError('CLI authorization missing; run tools/cli/xianji-omr.mjs auth')
        import re
        if credential.get('origin')!=self.origin or not re.fullmatch(r'omr_cli_[a-f0-9]{64}',credential.get('token','')):raise RuntimeError('Invalid CLI credential')
        if u.scheme=='http' and u.hostname not in ('localhost','127.0.0.1','::1') and not credential.get('allowInsecureHttp'):raise RuntimeError('Remote HTTP requires prior CLI --allow-insecure-http authorization')
        self.token=credential['token']
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs):return None
        self.opener=urllib.request.build_opener(NoRedirect())
    def request(self,path,body=None,method=None,timeout=30,headers=None,binary=False):
        if not path.startswith('/api/v2/') or '://' in path:raise ValueError('Invalid API path')
        h={'Authorization':'Bearer '+self.token,**(headers or {})}
        if body is not None and not isinstance(body,(bytes,bytearray)):
            body=json.dumps(body,allow_nan=False).encode();h['Content-Type']='application/json'
        request=urllib.request.Request(self.origin+path,data=body,headers=h,method=method or ('POST' if body is not None else 'GET'))
        try:
            with self.opener.open(request,timeout=timeout) as response:
                content=response.read()
                return (content,response.headers) if binary else json.loads(content)
        except urllib.error.HTTPError as error:
            message=error.read(4096).decode(errors='replace').replace(self.token,'[redacted]')
            raise PlatformHTTPError(error.code,message) from None
        except (OSError,urllib.error.URLError) as error:
            reason=error.reason if isinstance(error,urllib.error.URLError) else error
            # Exception text may contain URLs or credentials. Keep only diagnostic type/codes.
            codes=[type(reason).__name__]
            for field in ('errno','winerror'):
                value=getattr(reason,field,None)
                if isinstance(value,int):codes.append(field+'='+str(value))
            raise RuntimeError('Platform connection failed ('+', '.join(codes)+')') from None
    def upload(self,run_id,kind,path):
        path=Path(path);checksum=sha_file(path)
        # Small detector artifacts are bounded to 128 MiB by the server.
        if path.stat().st_size>128*1024*1024:raise ValueError('Model artifact exceeds 128 MiB')
        return self.request(f'/api/v2/training/runs/{run_id}/artifacts/{kind}',path.read_bytes(),timeout=900,
                            headers={'Content-Type':'application/octet-stream','Content-Length':str(path.stat().st_size),'X-Checksum-Sha256':checksum})

class Reporter:
    def __init__(self,platform,run_id,directory,heartbeat=False):
        self.api=platform;self.run_id=run_id;self.root=Path(directory);self.root.mkdir(parents=True,exist_ok=True)
        self.journal=self.root/'events.jsonl';self.cursor=self.root/'uploaded-cursor.json';self.lock=threading.Lock()
        self.events=[json.loads(line) for line in self.journal.read_text(encoding='utf-8').splitlines()] if self.journal.exists() else []
        if any(e['seq']!=i+1 for i,e in enumerate(self.events)):raise ValueError('Outbox journal is not contiguous')
        self.acked=json.loads(self.cursor.read_text())['last_seq'] if self.cursor.exists() else 0
        self.stop_event=threading.Event();self.last_error=None;self.auto_heartbeat=heartbeat;self.last_emit=time.monotonic()
        self.thread=threading.Thread(target=self._background,daemon=True);self.thread.start()
    def emit(self,kind,payload):
        with self.lock:
            event={'seq':len(self.events)+1,'kind':kind,'payload':payload}
            with self.journal.open('a',encoding='utf-8') as f:f.write(json.dumps(event,allow_nan=False)+'\n');f.flush();os.fsync(f.fileno())
            self.events.append(event);self.last_emit=time.monotonic()
    def flush(self):
        with self.lock:batch=self.events[self.acked:self.acked+100]
        if not batch:return True
        result=self.api.request(f'/api/v2/training/runs/{self.run_id}/events',{'events':batch},timeout=10)
        ack=result['last_seq']
        with self.lock:
            if ack<self.acked or ack>len(self.events):raise RuntimeError('Invalid server event cursor')
            self.acked=ack;save_json(self.cursor,{'last_seq':self.acked})
        self.last_error=None;return self.acked==len(self.events)
    def _background(self):
        while not self.stop_event.wait(2):
            try:
                if self.auto_heartbeat and time.monotonic()-self.last_emit>=15:self.emit('heartbeat',{})
                self.flush()
            except Exception as e:
                error=str(e)
                if error!=self.last_error:print(json.dumps({'event':'reporting-retry','error':error}),flush=True)
                self.last_error=error
    def close(self):
        self.stop_event.set();self.thread.join(timeout=15)
        # Single writer after background thread has stopped.
        if self.thread.is_alive():raise RuntimeError('Reporter is still flushing; retry publish later')
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            try:
                if self.flush():return
            except Exception:time.sleep(2)
        raise RuntimeError('Unsent metrics remain in local events.jsonl; use train.py --publish RUN_DIRECTORY')
