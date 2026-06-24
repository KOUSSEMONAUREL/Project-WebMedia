import sys, os, re, subprocess

def _parse_pg_url(url):
    m = re.match(r'^postgres(?:ql)?://(?:([^:@]+)(?::([^@]*))?@)?([^:/]+)(?::(\d+))?/(\S+?)(?:\?.*)?$', url)
    if not m:
        return None
    return {
        'user': m.group(1) or '',
        'password': m.group(2) or '',
        'host': m.group(3) or '',
        'port': m.group(4) or '5432',
        'dbname': m.group(5) or '',
    }

def _env_from_url():
    db_url = os.environ.get('SUPABASE_DATABASE_URL', '')
    if not db_url:
        return None
    parts = _parse_pg_url(db_url)
    if not parts:
        print("Warning: cannot parse SUPABASE_DATABASE_URL", file=sys.stderr)
        return None
    env = os.environ.copy()
    env['PGHOST'] = parts['host']
    env['PGPORT'] = parts['port']
    env['PGDATABASE'] = parts['dbname']
    env['PGUSER'] = parts['user']
    env['PGPASSWORD'] = parts['password']
    return env

def cmd_write(sha):
    env = _env_from_url()
    if not env or not sha:
        print("Warning: no Supabase URL or SHA, skipping write", file=sys.stderr)
        return
    sql = f"""
        INSERT INTO keiyoushi_state (key, value, updated_at)
        VALUES ('last_checked_commit', '{sha}', NOW())
        ON CONFLICT (key) DO UPDATE SET value = '{sha}', updated_at = NOW()
    """
    r = subprocess.run(['psql', '-c', sql, '-t', '-A'], env=env, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"Warning: Supabase persist failed ({r.returncode}): {r.stderr.strip()}", file=sys.stderr)

def cmd_read():
    env = _env_from_url()
    if not env:
        return ''
    r = subprocess.run(['psql', '-c', "SELECT value FROM keiyoushi_state WHERE key='last_checked_commit'", '-t', '-A'], env=env, capture_output=True, text=True)
    if r.returncode == 0:
        return r.stdout.strip()
    return ''

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
