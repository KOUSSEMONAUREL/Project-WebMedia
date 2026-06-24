import sys, os, re, subprocess, urllib.parse

def _parse_pg_url(raw):
    url = raw.strip() if raw else ''
    if not url:
        return None

    m = re.match(r'^postgres(?:ql)?://(?:([^:@]+)(?::([^@]*))?@)?([^:/]+)(?::(\d+))?/(\S+?)(?:\?.*)?$', url)
    if m:
        return {
            'user': m.group(1) or '',
            'password': m.group(2) or '',
            'host': m.group(3) or '',
            'port': m.group(4) or '5432',
            'dbname': m.group(5) or '',
        }

    try:
        p = urllib.parse.urlparse(url)
        if p.hostname and p.scheme:
            return {
                'user': p.username or '',
                'password': p.password or '',
                'host': p.hostname or '',
                'port': str(p.port) if p.port else '5432',
                'dbname': p.path.lstrip('/') if p.path else '',
            }
    except Exception:
        pass

    # Peut-être en format key=value (libpq)
    kv = dict(kv.split('=', 1) for kv in url.split() if '=' in kv)
    if 'host' in kv and 'dbname' in kv:
        return {
            'user': kv.get('user', ''),
            'password': kv.get('password', ''),
            'host': kv['host'],
            'port': kv.get('port', '5432'),
            'dbname': kv['dbname'],
        }

    # Peut-être sans le prefixe postgresql://
    if not url.startswith('postgres'):
        return _parse_pg_url('postgresql://' + url)

    return None

def _env_from_url():
    db_url = os.environ.get('SUPABASE_DATABASE_URL', '')
    if not db_url:
        print("Warning: SUPABASE_DATABASE_URL not set", file=sys.stderr)
        return None
    parts = _parse_pg_url(db_url)
    if not parts:
        safe = db_url[:30] + '...' if len(db_url) > 30 else db_url
        print(f"Warning: cannot parse SUPABASE_DATABASE_URL (len={len(db_url)}, start={safe!r})", file=sys.stderr)
        try:
            import urllib.parse as up
            p = up.urlparse(url)
            port_str = str(p.port) if p.port else 'None'
            print(f"  urlparse: scheme={p.scheme!r} hostname={p.hostname!r} port={port_str} path={p.path!r}", file=sys.stderr)
        except Exception as e:
            print(f"  urlparse error: {e}", file=sys.stderr)
        return None
    if not parts['host'] or not parts['dbname']:
        print(f"Warning: parsed URL missing host or dbname ({parts})", file=sys.stderr)
        return None
    env = os.environ.copy()
    env['PGHOST'] = parts['host']
    env['PGPORT'] = parts['port']
    env['PGDATABASE'] = parts['dbname']
    env['PGUSER'] = parts['user']
    env['PGPASSWORD'] = parts['password']
    env['PGCONNECT_TIMEOUT'] = '10'
    return env

def cmd_write(sha):
    env = _env_from_url()
    if not env or not sha:
        return
    sql = (
        "INSERT INTO keiyoushi_state (key, value, updated_at) "
        "VALUES ('last_checked_commit', :sha, NOW()) "
        "ON CONFLICT (key) DO UPDATE SET value = :sha, updated_at = NOW()"
    ).replace(':sha', f"'{sha}'")
    try:
        r = subprocess.run(['psql', '-c', sql, '-t', '-A'], env=env, capture_output=True, text=True, timeout=20)
        if r.returncode != 0:
            err = r.stderr.strip()[:200]
            print(f"Warning: Supabase persist failed ({r.returncode}): {err}", file=sys.stderr)
    except subprocess.TimeoutExpired:
        print("Warning: Supabase persist timed out after 20s", file=sys.stderr)

def cmd_read():
    env = _env_from_url()
    if not env:
        return ''
    try:
        r = subprocess.run(
            ['psql', '-c', "SELECT value FROM keiyoushi_state WHERE key='last_checked_commit'", '-t', '-A'],
            env=env, capture_output=True, text=True, timeout=20
        )
        if r.returncode == 0:
            return r.stdout.strip()
    except subprocess.TimeoutExpired:
        print("Warning: Supabase read timed out after 20s", file=sys.stderr)
    return ''

def cmd_test():
    env = _env_from_url()
    if not env:
        print("❌ Cannot parse URL")
        sys.exit(1)
    try:
        r = subprocess.run(['psql', '-c', 'SELECT 1', '-t', '-A'], env=env, capture_output=True, text=True, timeout=15)
        if r.returncode == 0:
            print(f"✅ Supabase connected (host={env.get('PGHOST','?')})")
        else:
            print(f"❌ psql error ({r.returncode}): {r.stderr.strip()[:200]}")
            sys.exit(1)
    except subprocess.TimeoutExpired:
        print("❌ Connection timed out after 15s")
        sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(0)
    op = sys.argv[1]
    if op == 'write':
        cmd_write(sys.argv[2] if len(sys.argv) > 2 else '')
    elif op == 'read':
        val = cmd_read()
        if val:
            print(val)
    elif op == 'test':
        cmd_test()
